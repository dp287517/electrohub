# DeepSearch++ v5 — Ask Veeva
# FastAPI micro-service: retrieval “qui tape fort”
# - Hybrid sparse: BM25 + TF-IDF(word 1..3) + TF-IDF(char 3..5)
# - Domain-normalization (SOP/N####-#, IDR) + bilingual FR<->EN expansion
# - Heuristics: filename boosts, code boosts, negative tokens, role/sector bias
# - Query rewriting: multi-subqueries (FR/EN, codes, variantes) + synonym DB + next_terms
# - Two-stage MMR (doc-level then chunk-level) to maximize diversity
# - Optional Cross-Encoder rerank (default: BAAI/bge-reranker-large, fallback to MiniLM)
# - Phrase-level evidence: optional table askv_spans (span embeddings) if present
# - /compare endpoint: builds an evidence matrix across docs (criteria planner light)
# - Answerability guard (light): CERTAIN | PARTIAL | NR based on evidence coverage
#
# Read-only Postgres. Everything degrades gracefully if advanced schema absent.
#
# Endpoints:
#   GET  /health
#   POST /reindex
#   POST /search {query,k,role,sector,rerank,deep,next_terms?}
#   POST /compare {topic, doc_ids[], criteria?, k_per_crit?, role?, sector?}
#
# Launch:
#   uvicorn pysearch_service:app --host 0.0.0.0 --port 8088
# Or:
#   python pysearch_service.py

import os, re, json, time, math
from typing import List, Dict, Any, Optional, Tuple

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import psycopg2
from psycopg2.extras import RealDictCursor

from unidecode import unidecode
from rapidfuzz import fuzz
from rank_bm25 import BM25Okapi

from sklearn.feature_extraction.text import TfidfVectorizer
import numpy as np

# ---------------- Config / env ----------------
PG_URL = os.getenv("NEON_DATABASE_URL") or os.getenv("DATABASE_URL")

TOPK_DEFAULT = int(os.getenv("PYSEARCH_TOPK", "60"))
DEEP_ON = os.getenv("PYSEARCH_DEEP", "1").strip().lower() not in ("0","false","no")

# Cross-Encoder rerank
RERANK_ENABLED = os.getenv("PYSEARCH_RERANK", "1").strip().lower() not in ("0","false","no")
DEFAULT_RERANK_MODEL = "BAAI/bge-reranker-large"
FALLBACK_RERANK_MODEL = "cross-encoder/ms-marco-MiniLM-L-6-v2"
RERANK_MODEL_NAME = os.getenv("PYSEARCH_RERANK_MODEL", DEFAULT_RERANK_MODEL)
RERANK_CAND = int(os.getenv("PYSEARCH_RERANK_CAND", "150"))
RERANK_KEEP = int(os.getenv("PYSEARCH_RERANK_KEEP", "80"))
RERANK_ALPHA = float(os.getenv("PYSEARCH_RERANK_ALPHA", "0.85"))  # blend CE vs hybrid

# MMR diversification
MMR_LAMBDA_DOC = float(os.getenv("PYSEARCH_MMR_LAMBDA_DOC", "0.75"))
MMR_LAMBDA_CHUNK = float(os.getenv("PYSEARCH_MMR_LAMBDA_CHUNK", "0.70"))
MMR_LIMIT_DOC = int(os.getenv("PYSEARCH_MMR_LIMIT_DOC", "40"))
MMR_LIMIT_CHUNK = int(os.getenv("PYSEARCH_MMR_LIMIT_CHUNK", "24"))

# Evidence / spans
USE_SPANS = os.getenv("PYSEARCH_USE_SPANS", "1").strip().lower() not in ("0","false","no")
SPANS_TOP = int(os.getenv("PYSEARCH_SPANS_TOP", "3"))

# Anticipation (+1 tour light) – can be disabled
PREDICT_NEXT_ON = os.getenv("PYSEARCH_PREDICT_NEXT", "1").strip().lower() not in ("0","false","no")

# Keyword/domain boosts
KEYWORD_BOOSTS = {
    "sop": 0.30, "procédure": 0.25, "procedure": 0.25,
    "déchet": 0.45, "dechet": 0.45, "déchets": 0.45, "waste": 0.35,
    "sécurité": 0.25, "securite": 0.25, "safety": 0.25,
    "maintenance": 0.22, "validation": 0.22, "nettoyage": 0.22, "cleaning": 0.22,
    "checklist": 0.30, "inspection": 0.18, "liste": 0.20, "contrôle": 0.18, "controle": 0.18,
    "idr": 0.55, "format": 0.25, "vignetteuse": 0.40, "neri": 0.20, "notice": 0.18,
    "réglages": 0.22, "reglages": 0.22, "ssol": 0.20, "liq": 0.20, "bulk": 0.15,
    "vfd": 0.45, "variable": 0.12, "frequency": 0.12, "inverter": 0.22, "drive": 0.16,
    "policy": 0.18, "policies": 0.18, "global": 0.12, "site": 0.10, "plant": 0.10
}

# FR<->EN defaults (only if synonyms miss)
BILINGUAL_DEFAULTS = [
    ("procédure", "procedure standard operating procedure SOP"),
    ("liste de contrôle", "checklist check list inspection list"),
    ("gestion des déchets", "waste management disposal segregation"),
    ("sécurité", "safety EHS HSE"),
    ("maintenance", "maintenance preventive corrective PM"),
    ("nettoyage", "cleaning sanitation washdown"),
    ("validation", "validation IQ OQ PQ"),
    ("format", "setup changeover format settings"),
    ("traçabilité", "traceability genealogy"),
]

# Anticipation "en pouvoir": liste large de termes interprétables (FR/EN)
NEXT_SEED_TERMS = [
    # aide / intention d'action
    "que faire", "quoi faire", "je suis perdu", "j'ai besoin d'aide", "help", "how to",
    "procedure/steps", "procédure/étapes", "responsabilités", "responsibilities",
    "enregistrements", "records", "définitions", "definitions", "références", "references",
    # qualité / NC / CAPA
    "non conformité", "non-conformité", "nc", "déviation", "deviation", "capa", "action corrective",
    # EHS / IPC / paramètres
    "EHS", "HSE", "sécurité", "safety", "IPC", "contrôles", "controls",
    "tolérances", "parameters", "fréquences", "frequencies",
    # Validation / changeover / traçabilité
    "validation", "IQ", "OQ", "PQ", "format", "changeover", "traçabilité", "traceability",
    # équipements / nettoyage
    "matériel", "équipements", "equipment", "nettoyage", "cleaning",
]

# ----- Cross-Encoder (optional) -----
ce_model = None
ce_device = None
if RERANK_ENABLED:
    try:
        import torch
        from sentence_transformers import CrossEncoder
        dev = os.getenv("PYSEARCH_DEVICE")
        if dev not in ("cpu", "cuda"):
            dev = "cuda" if torch.cuda.is_available() else "cpu"
        ce_device = dev
        try:
            ce_model = CrossEncoder(RERANK_MODEL_NAME, device=dev)
        except Exception:
            # fallback quietly
            RERANK_MODEL_NAME = FALLBACK_RERANK_MODEL
            ce_model = CrossEncoder(RERANK_MODEL_NAME, device=dev)
        print(f"[pysearch] Cross-encoder: {RERANK_MODEL_NAME} on {dev}")
    except Exception as e:
        print(f"[pysearch] WARN: cross-encoder disabled ({e})")
        ce_model = None
        RERANK_ENABLED = False

if not PG_URL:
    print("[pysearch] WARN: no Postgres URL in NEON_DATABASE_URL/DATABASE_URL")

# ---------------- Patterns / normalization ----------------
RE_SOP_NUM = re.compile(r"\b(?:QD-?)?SOP[-\s]?(\d{4,7})\b", re.I)
RE_SOP_FULL = re.compile(r"\b(?:QD-?)?SOP[-\s]?[A-Z0-9\-]{3,}\b", re.I)
RE_NLINE = re.compile(r"\bN?\s*(?P<base>[12]\d{3})\s*(?:-|_|\s)?\s*(?P<suf>\d)\b", re.I)
RE_IDR = re.compile(r"\bI\.?D\.?R\.?\b", re.I)

def normalize_codes(s: str) -> str:
    t = s
    def _sop_pad(m):
        num = m.group(1)
        num = num.zfill(6) if len(num) <= 6 else num
        return f"QD-SOP-{num}"
    t = RE_SOP_NUM.sub(_sop_pad, t)
    def _nline(m):
        return f"N{m.group('base')}-{m.group('suf')}"
    t = RE_NLINE.sub(_nline, t)
    t = RE_IDR.sub("IDR", t)
    return t

def norm(s: str) -> str:
    s = s or ""
    s = s.replace("\u00A0", " ")
    s = normalize_codes(s)
    s = unidecode(s.lower())
    s = re.sub(r"\s+", " ", s).strip()
    return s

def tokenize(s: str) -> List[str]:
    return re.findall(r"[a-z0-9\-_/\.]+", norm(s))

def extract_codes(text: str) -> List[str]:
    s = text or ""
    out = set()
    for m in RE_SOP_NUM.findall(s):
        out.add(f"QD-SOP-{str(m).zfill(6)}")
    for m in RE_SOP_FULL.findall(s):
        out.add(m)
    for m in RE_NLINE.finditer(s):
        out.add(f"N{m.group('base')}-{m.group('suf')}")
    if RE_IDR.search(s):
        out.add("IDR")
    return list(out)

def is_general_filename(fn: str) -> bool:
    f = norm(fn)
    has_line_no = bool(re.search(r"\b(91\d{2}|n[12]\d{3}-\d|ligne|line|micro)\b", f))
    is_sop = bool(re.search(r"\b(sop|qd-sop)\b", f))
    has_global = bool(re.search(r"\b(proc(edure|e)|dechet|dechets|waste|global|site|usine|policy|policies)\b", f))
    return (is_sop or has_global) and not has_line_no

def is_specific_filename(fn: str) -> bool:
    f = norm(fn)
    return bool(re.search(r"\b(91\d{2}|n[12]\d{3}-\d|ligne|line|micro|neri|vignetteuse)\b", f))

def intent_from_query(q: str) -> Tuple[bool,bool]:
    n = norm(q)
    prefer_global = any(w in n for w in ["global", "generale", "générale", "procedure", "procédure", "site", "usine", "policy", "policies"])
    prefer_sop = any(w in n for w in ["sop", "procédure", "procedure", "qd-sop"])
    return prefer_global, prefer_sop

# ---------------- Language guess (very light) ----------------
FR_HINTS = (" le ", " la ", " les ", " des ", " du ", " de ", " procédure", " déchets", " sécurité", " variateur")
EN_HINTS = (" the ", " and ", " or ", " procedure", " checklist", " safety", " waste", " validation")
def guess_lang(q: str) -> str:
    n = f" {norm(q)} "
    fr = sum(1 for h in FR_HINTS if h in n) + (2 if re.search(r"[éèàùâêîôûç]", q) else 0)
    en = sum(1 for h in EN_HINTS if h in n)
    if fr - en >= 2: return "fr"
    if en - fr >= 2: return "en"
    return "fr"

# ---------------- Data holders (RAM index) ----------------
DOCS: List[Dict[str, Any]] = []           # rows from askv_chunks (+optional: page, section_title)
TOKS: List[List[str]] = []
FILEN_TOKS: List[List[str]] = []
CODES: List[List[str]] = []

ROW_TFIDF = None
ROW_CTFIDF = None
BM25: Optional[BM25Okapi] = None
VECT_WORD: Optional[TfidfVectorizer] = None
TFIDF_WORD = None
VECT_CHAR: Optional[TfidfVectorizer] = None
TFIDF_CHAR = None

# spans (optional)
HAS_SPANS = False
SPANS: List[Dict[str, Any]] = []          # askv_spans rows
SPANS_DOCIDX: Dict[str, List[int]] = {}   # doc_id -> indices in SPANS

# ---------------- DB helpers ----------------
def db_query(sql: str, params=()):
    conn = psycopg2.connect(PG_URL)
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, params)
            return cur.fetchall()
    finally:
        conn.close()

def table_exists(name: str) -> bool:
    rows = db_query(
        "SELECT to_regclass(%s) AS t",
        (name,)
    )
    return bool(rows and rows[0]["t"])

def load_chunks():
    # Try to pull optional columns if present (page, section_title)
    has_page = False
    has_title = False
    cols = db_query("""
        SELECT column_name FROM information_schema.columns
        WHERE table_name='askv_chunks'
    """)
    cset = {c["column_name"] for c in cols}
    has_page = "page" in cset
    has_title = "section_title" in cset

    base_cols = "c.id AS chunk_id, c.doc_id, c.chunk_index, c.content, d.filename"
    if has_page: base_cols += ", c.page"
    if has_title: base_cols += ", c.section_title"

    rows = db_query(f"""
        SELECT {base_cols}
        FROM askv_chunks c
        JOIN askv_documents d ON d.id = c.doc_id
        ORDER BY c.id ASC
    """)
    return rows

def load_spans_if_any():
    global HAS_SPANS, SPANS, SPANS_DOCIDX
    HAS_SPANS = table_exists("askv_spans")
    SPANS = []
    SPANS_DOCIDX = {}
    if not HAS_SPANS or not USE_SPANS:
        return
    # optional columns: page, bbox float4[]
    cols = db_query("""
        SELECT column_name FROM information_schema.columns
        WHERE table_name='askv_spans'
    """)
    cset = {c["column_name"] for c in cols}
    has_page = "page" in cset
    has_bbox = "bbox" in cset

    span_cols = "id, doc_id, chunk_index, span_index, text"
    if has_page: span_cols += ", page"
    if has_bbox: span_cols += ", bbox"

    SPANS = db_query(f"""
        SELECT {span_cols}
        FROM askv_spans
        ORDER BY id ASC
    """) or []
    # Build index per doc_id
    for i, s in enumerate(SPANS):
        d = str(s["doc_id"])
        SPANS_DOCIDX.setdefault(d, []).append(i)

# ---------------- Indexing ----------------
def build_index():
    global DOCS, TOKS, FILEN_TOKS, CODES
    global BM25, VECT_WORD, TFIDF_WORD, VECT_CHAR, TFIDF_CHAR
    global ROW_TFIDF, ROW_CTFIDF

    t0 = time.time()

    rows = load_chunks()
    DOCS = rows

    TOKS = [tokenize(r.get("content") or "") for r in DOCS]
    FILEN_TOKS = [tokenize(r.get("filename") or "") for r in DOCS]
    CODES = [extract_codes((r.get("content") or "") + " " + (r.get("filename") or "")) for r in DOCS]

    BM25 = BM25Okapi(TOKS) if len(DOCS) else None

    corpus = [norm((r.get("content") or "") + " " + (r.get("filename") or "")) for r in DOCS]

    if corpus:
        VECT_WORD = TfidfVectorizer(analyzer="word", ngram_range=(1,3), min_df=2, max_df=0.95)
        TFIDF_WORD = VECT_WORD.fit_transform(corpus)

        VECT_CHAR = TfidfVectorizer(analyzer="char", ngram_range=(3,5), min_df=2, max_df=0.90)
        TFIDF_CHAR = VECT_CHAR.fit_transform(corpus)

        def l2norm(mat):
            norms = np.sqrt((mat.power(2)).sum(axis=1)).A1 + 1e-12
            inv = 1.0 / norms
            return mat.multiply(inv[:,None])
        ROW_TFIDF = l2norm(TFIDF_WORD)
        ROW_CTFIDF = l2norm(TFIDF_CHAR)
    else:
        VECT_WORD = TFIDF_WORD = None
        VECT_CHAR = TFIDF_CHAR = None
        ROW_TFIDF = ROW_CTFIDF = None

    # Load spans (optional)
    load_spans_if_any()

    secs = round(time.time() - t0, 3)
    print(f"[pysearch] indexed chunks={len(DOCS)} spans={len(SPANS) if HAS_SPANS else 0} in {secs}s")
    return {"docs": len(DOCS), "spans": len(SPANS) if HAS_SPANS else 0, "secs": secs}

def ensure_index():
    if not DOCS:
        return build_index()
    return {"docs": len(DOCS), "spans": len(SPANS) if HAS_SPANS else 0, "secs": 0.0}

# ---------------- Synonyms / expansion ----------------
def fetch_synonyms_for_tokens(tokens: List[str]) -> List[Tuple[str,str,float]]:
    if not tokens:
        return []
    qs = ",".join(["%s"] * len(tokens))
    sql = f"""
      SELECT term, alt_term, COALESCE(weight,1.0) AS weight
      FROM askv_synonyms
      WHERE LOWER(term) IN ({qs}) OR LOWER(alt_term) IN ({qs})
      LIMIT 1000
    """
    params = [t.lower() for t in tokens] + [t.lower() for t in tokens]
    try:
        rows = db_query(sql, params)
        return [(r["term"], r["alt_term"], float(r["weight"])) for r in rows]
    except Exception:
        return []

def deep_expand_query(raw_q: str) -> str:
    if not DEEP_ON:
        return raw_q
    n = norm(raw_q)
    toks = [t for t in re.findall(r"[a-z0-9\-_/\.]+", n) if t]

    syns = fetch_synonyms_for_tokens(toks)
    extras = []
    for _term, alt, _w in syns:
        if alt and alt.lower() not in n:
            extras.append(alt)

    # bilingual defaults only if no DB synonym
    if not extras:
        for fr, en in BILINGUAL_DEFAULTS:
            if fr in n and en not in n:
                extras.append(en)
            elif en in n and fr not in n:
                extras.append(fr)

    if extras:
        return raw_q + " " + " ".join(sorted(set(extras)))
    return raw_q

def predict_next_terms(question: str, last_answer: Optional[str] = None, limit: int = 5) -> List[str]:
    """Ultra-light local 'anticipation': renvoie quelques seeds interprétables."""
    if not PREDICT_NEXT_ON:
        return []
    base = (question or "") + " " + (last_answer or "")
    n = norm(base)
    # filtre grossier: ne répète pas un terme déjà présent
    out = []
    for w in NEXT_SEED_TERMS:
        if norm(w) not in n:
            out.append(w)
        if len(out) >= limit:
            break
    return out

def generate_subqueries(q: str, next_terms: Optional[List[str]] = None) -> List[str]:
    """FR/EN variants + code-focused & phrase-trimmed versions + next_terms injection."""
    n = norm(q)
    subs = {q}

    # If contains SOP/N####-#/IDR codes, isolate code-only subquery
    codes = extract_codes(q)
    for c in codes:
        subs.add(c)

    # Shorten very long queries to head bigrams for recall
    toks = tokenize(q)
    if len(toks) > 10:
        subs.add(" ".join(toks[:6]))

    # FR<->EN promptless swap (very light)
    for fr, en in BILINGUAL_DEFAULTS:
        if fr in n: subs.add(q + " " + en)
        if any(w in n for w in en.split()):
            subs.add(q + " " + fr)

    # DB synonym expansion (short)
    syns = fetch_synonyms_for_tokens(toks[:6])
    for _, alt, _w in syns:
        if alt:
            subs.add(q + " " + alt)

    # Inject next_terms (poids faible — on ajoute des sous-queries étendues)
    if next_terms:
        for t in next_terms[:5]:
            subs.add(q + " " + str(t))

    return list(subs)[:10]  # petit cap

# ---------------- Scoring core ----------------
def score_arrays_for_query(q: str) -> Tuple[np.ndarray,np.ndarray,np.ndarray,np.ndarray,np.ndarray,np.ndarray]:
    qn = norm(q)
    q_tokens = tokenize(q)
    q_codes = extract_codes(q)

    neg_tokens = [t[1:] for t in q_tokens if t.startswith("-") and len(t) > 1]
    q_tokens = [t for t in q_tokens if not t.startswith("-")]

    bm = np.zeros(len(DOCS))
    if BM25 and q_tokens:
        bm = np.array(BM25.get_scores(q_tokens))

    tf_word = np.zeros(len(DOCS))
    if TFIDF_WORD is not None and VECT_WORD is not None:
        qvec_word = VECT_WORD.transform([qn])
        tf_word = (TFIDF_WORD @ qvec_word.T).toarray().ravel()

    tf_char = np.zeros(len(DOCS))
    if TFIDF_CHAR is not None and VECT_CHAR is not None:
        qvec_char = VECT_CHAR.transform([qn])
        tf_char = (TFIDF_CHAR @ qvec_char.T).toarray().ravel()

    fname = np.zeros(len(DOCS))
    qset = set(q_tokens)
    for i, ft in enumerate(FILEN_TOKS):
        if not ft: continue
        inter = qset.intersection(ft)
        if inter:
            fname[i] += min(0.5, 0.12 * len(inter))
        lowfname = " ".join(ft)
        for kw, b in KEYWORD_BOOSTS.items():
            if kw in lowfname:
                fname[i] += b
        for nt in neg_tokens:
            if nt and nt in lowfname:
                fname[i] -= 0.25

    code_boost = np.zeros(len(DOCS))
    for i, codes in enumerate(CODES):
        if not codes: continue
        for qc in q_codes:
            if qc in codes:
                code_boost[i] += 1.25
            else:
                if any(fuzz.ratio(qc.lower(), c.lower()) >= 90 for c in codes):
                    code_boost[i] += 0.7

    fuzzy = np.zeros(len(DOCS))
    if len(qn) >= 5:
        for i, r in enumerate(DOCS):
            f = r.get("filename") or ""
            if not f: continue
            sc = fuzz.partial_ratio(qn, norm(f))
            if sc >= 92: fuzzy[i] = 0.45
            elif sc >= 84: fuzzy[i] = 0.25
            elif sc >= 78: fuzzy[i] = 0.12

    return bm, tf_word, tf_char, fname, code_boost, fuzzy

def _z(x: np.ndarray) -> np.ndarray:
    if x.size == 0: return x
    m = np.mean(x); s = np.std(x) or 1.0
    return (x - m) / s

def combine_scores(arrs: List[np.ndarray]) -> np.ndarray:
    bm, tfw, tfc, fname, code_boost, fuzzy = arrs
    return 0.60*_z(bm) + 0.56*_z(tfw) + 0.22*_z(tfc) + fname + code_boost + 0.5*fuzzy

def score_hybrid_single(q: str, role: Optional[str], sector: Optional[str]) -> np.ndarray:
    prefer_global, prefer_sop = intent_from_query(q)
    bm, tfw, tfc, fname, code_boost, fuzzy = score_arrays_for_query(q)

    rs = np.zeros(len(DOCS))
    rlow = (role or "").lower()
    slow = (sector or "").lower()
    if rlow or slow:
        for i, r in enumerate(DOCS):
            fn = (r.get("filename") or "").lower()
            if rlow and rlow in fn: rs[i] += 0.06
            if slow and slow in fn: rs[i] += 0.06

    intent = np.zeros(len(DOCS))
    for i, r in enumerate(DOCS):
        fn = r.get("filename") or ""
        if prefer_global:
            if is_general_filename(fn): intent[i] += 0.35
            if is_specific_filename(fn): intent[i] -= 0.15
        else:
            if is_specific_filename(fn): intent[i] += 0.12
        if prefer_sop and re.search(r"\b(sop|qd-sop)\b", fn, re.I):
            intent[i] += 0.25

    S = combine_scores([bm, tfw, tfc, fname, code_boost, fuzzy]) + rs + intent
    return S

def aggregate_over_subqueries(q: str, role: Optional[str], sector: Optional[str], next_terms: Optional[List[str]] = None) -> np.ndarray:
    """Blend scores over generated sub-queries for recall."""
    subs = [q] + generate_subqueries(q, next_terms=next_terms)
    # poids décroissants ; next_terms étant dans subs, ils héritent d'un poids bas
    weights = np.linspace(1.0, 0.6, num=len(subs))
    S = np.zeros(len(DOCS))
    for w, sq in zip(weights, subs):
        S += w * score_hybrid_single(sq, role, sector)
    return S

# ---------------- Two-stage MMR ----------------
def _mmr_from_rows(rowvecs, qvec, lam, limit) -> List[int]:
    if rowvecs is None: return list(range(min(limit, 0)))
    # normalized rowvecs expected
    rel = (rowvecs @ qvec.T).toarray().ravel()
    selected, selected_idx = [], set()
    sim_mat = (rowvecs @ rowvecs.T).toarray()
    avail = list(range(rowvecs.shape[0]))
    while avail and len(selected) < min(limit, rowvecs.shape[0]):
        if not selected:
            i_best = int(np.argmax(rel[avail]))
            chosen = avail[i_best]
        else:
            scores = []
            for idx_cand in avail:
                max_sim = max(sim_mat[idx_cand, j] for j in selected_idx) if selected_idx else 0.0
                mmr = lam * rel[idx_cand] - (1 - lam) * max_sim
                scores.append((mmr, idx_cand))
            scores.sort(reverse=True, key=lambda x: x[0])
            chosen = scores[0][1]
        selected.append(chosen)
        selected_idx.add(chosen)
        avail.remove(chosen)
    return selected

def mmr_two_stage(items: List[Dict[str,Any]], k: int, q: str) -> List[Dict[str,Any]]:
    if not items or ROW_TFIDF is None or VECT_WORD is None:
        return items[:k]
    # doc-level: map each item to doc row centroid (approx by first chunk row)
    doc_to_rows = {}
    for idx, it in enumerate(items):
        # find RAM row index
        ridx = next((i for i, d in enumerate(DOCS) if d["chunk_id"] == it["chunk_id"]), -1)
        if ridx < 0: continue
        doc_to_rows.setdefault(it["doc_id"], []).append(ridx)

    # build unique doc list & choose representative row per doc (first for now)
    docs = list(doc_to_rows.keys())
    rep_rows = [doc_to_rows[d][0] for d in docs]
    doc_rowvecs = ROW_TFIDF[rep_rows]
    qvec = VECT_WORD.transform([norm(q)])
    qnorm = math.sqrt((qvec.power(2)).sum()) + 1e-12
    qv = (qvec / qnorm)

    keep_docs_idx = _mmr_from_rows(doc_rowvecs, qv, MMR_LAMBDA_DOC, min(MMR_LIMIT_DOC, len(docs)))
    keep_docs = {docs[i] for i in keep_docs_idx}

    # second stage: within kept docs, run chunk-level MMR on their items
    kept_items = [it for it in items if it["doc_id"] in keep_docs]
    # Rebuild row list for kept items
    kept_rows = []
    for it in kept_items:
        ridx = next((i for i, d in enumerate(DOCS) if d["chunk_id"] == it["chunk_id"]), -1)
        if ridx >= 0: kept_rows.append(ridx)
    if not kept_rows: return items[:k]
    chunk_rowvecs = ROW_TFIDF[kept_rows]
    keep_idx_rel = _mmr_from_rows(chunk_rowvecs, qv, MMR_LAMBDA_CHUNK, min(MMR_LIMIT_CHUNK, len(kept_items)))
    kept = [kept_items[i] for i in keep_idx_rel]
    return kept[:k]

# ---------------- Evidence via spans (optional) ----------------
def best_spans_for(doc_id: str, query: str, limit: int = 3) -> List[Dict[str,Any]]:
    """Return top spans (by simple BM25-like score against query terms), fallback to empty."""
    if not HAS_SPANS or not USE_SPANS:
        return []
    idxs = SPANS_DOCIDX.get(str(doc_id), [])
    if not idxs:
        return []
    q_tokens = tokenize(query)
    scores = []
    for i in idxs:
        s = SPANS[i]
        toks = tokenize(s.get("text") or "")
        inter = len(set(q_tokens).intersection(toks))
        sc = inter + 0.0001 * (len(toks) > 0)  # tiny stabilizer
        scores.append((sc, i))
    scores.sort(reverse=True, key=lambda x: x[0])
    out = []
    for _, i in scores[:limit]:
        s = SPANS[i]
        out.append({
            "text": s.get("text"),
            "page": s.get("page"),
            "bbox": s.get("bbox"),
            "chunk_index": s.get("chunk_index"),
            "span_index": s.get("span_index")
        })
    return out

# ---------------- Answerability (light) ----------------
def answerability_label(evidence_counts: List[int], need: int = 2) -> str:
    tot = sum(1 for c in evidence_counts if c > 0)
    if tot >= need: return "CERTAIN"
    if tot == 1: return "PARTIAL"
    return "NR"

# ---------------- FastAPI models ----------------
class SearchReq(BaseModel):
    query: str
    k: Optional[int] = None
    role: Optional[str] = None
    sector: Optional[str] = None
    rerank: Optional[bool] = None
    deep: Optional[bool] = None
    next_terms: Optional[List[str]] = None  # <<< NEW

class CompareReq(BaseModel):
    topic: str = Field(..., description="Sujet/objet de la comparaison")
    doc_ids: List[str] = Field(..., description="Liste de documents à comparer (UUIDs)")
    criteria: Optional[List[str]] = None
    k_per_crit: Optional[int] = 3
    role: Optional[str] = None
    sector: Optional[str] = None

# ---------------- FastAPI app ----------------
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"]
)

@app.get("/health")
def health():
    syn_count = None
    try:
        r = db_query("SELECT COUNT(*)::int AS n FROM askv_synonyms")
        syn_count = r[0]["n"] if r else 0
    except Exception:
        syn_count = None
    return {
        "ok": True,
        "chunks": len(DOCS),
        "spans": len(SPANS) if HAS_SPANS else 0,
        "bm25": BM25 is not None,
        "tfidf_word": TFIDF_WORD is not None,
        "tfidf_char": TFIDF_CHAR is not None,
        "rerank": bool(RERANK_ENABLED and ce_model is not None),
        "model_ce": RERANK_MODEL_NAME if (RERANK_ENABLED and ce_model is not None) else None,
        "deep": bool(DEEP_ON),
        "mmr": {"doc_lambda": MMR_LAMBDA_DOC, "chunk_lambda": MMR_LAMBDA_CHUNK,
                "doc_limit": MMR_LIMIT_DOC, "chunk_limit": MMR_LIMIT_CHUNK},
        "use_spans": bool(HAS_SPANS and USE_SPANS),
        "predict_next": bool(PREDICT_NEXT_ON),
        "synonyms": syn_count
    }

@app.post("/reindex")
def reindex():
    info = build_index()
    return {"ok": True, **info}

# ---------------- Deep candidates + rerank (multi-objectif) ----------------
def deep_candidates(q: str, k: int, role: Optional[str], sector: Optional[str], next_terms: Optional[List[str]] = None) -> List[Dict[str,Any]]:
    baseK = max(k, RERANK_KEEP) if RERANK_ENABLED else k
    S = aggregate_over_subqueries(q, role, sector, next_terms=next_terms)
    # take top baseK by score
    if len(S) == 0: return []
    kprime = min(max(baseK, 1), len(S))
    idx = np.argpartition(-S, kprime - 1)[:kprime]
    idx = idx[np.argsort(-S[idx])]

    prelim = []
    for i in idx:
        r = DOCS[i]
        prelim.append({
            "chunk_id": r["chunk_id"],
            "doc_id": str(r["doc_id"]),
            "filename": r.get("filename"),
            "chunk_index": r.get("chunk_index"),
            "score": float(S[i]),
            "codes": CODES[i],
            "snippet": (r.get("content") or "")[:900],
            "page": r.get("page"),
            "section_title": r.get("section_title")
        })

    # coverage par doc (contrat de preuve light, basé sur spans)
    for it in prelim:
        cov = 0.0
        if HAS_SPANS and USE_SPANS:
            spans = best_spans_for(it["doc_id"], q, limit=SPANS_TOP)
            cov = min(len(spans) / float(max(1, SPANS_TOP)), 1.0)
        it["_coverage"] = float(cov)

    # rerank (optional) + multi-objectif
    items = prelim
    if RERANK_ENABLED and ce_model is not None and items:
        pool = items[:min(len(items), RERANK_CAND)]
        pairs = [(q, f"{it['filename']} — {it.get('snippet','')}") for it in pool]
        scores = ce_model.predict(pairs, convert_to_numpy=True, show_progress_bar=False)
        # Blend multi-objectif
        n_has_code = re.search(r"\b(sop|qd-sop|n[12]\d{3}-\d|idr)\b", norm(q)) is not None
        for it, sc in zip(pool, scores):
            ce = float(sc)
            it["_score_ce"] = ce
            cov = float(it.get("_coverage", 0.0))
            codeb = 1.0 if any(c for c in (it.get("codes") or []) if str(c).startswith("QD-SOP-") or str(c) == "IDR") else 0.0
            # léger biais rôle/secteur déjà injecté en hybrid, on le garde minimal ici
            roleb = 0.06
            # pondérations adaptatives
            α = 0.70
            β = 0.10 if n_has_code else 0.25  # coverage pèse plus quand on n'a pas de code explicite
            γ = 0.30 if n_has_code else 0.10  # code boost pèse plus quand la requête contient des codes
            δ = 0.05
            it["score_final"] = α*ce + β*cov + γ*codeb + δ*roleb + (1 - RERANK_ALPHA) * float(it.get("score", 0.0)) * 0.10
        pool.sort(key=lambda x: x["score_final"], reverse=True)
        items = pool[:max(k, RERANK_KEEP)]
    else:
        # Pas de CE : on mélange hybrid normalisé + coverage + codeb
        for it in items:
            base = float(it.get("score", 0.0))
            cov = float(it.get("_coverage", 0.0))
            codeb = 1.0 if any(c for c in (it.get("codes") or []) if str(c).startswith("QD-SOP-") or str(c) == "IDR") else 0.0
            it["score_final"] = 0.80*base + 0.15*cov + 0.05*codeb
        items.sort(key=lambda x: x["score_final"], reverse=True)

    # two-stage MMR pour stabilité/diversité
    if DEEP_ON and items:
        items = mmr_two_stage(items, k, q)

    return items[:k]

@app.post("/search")
def search(req: SearchReq):
    ensure_index()
    q = normalize_codes(req.query or "")
    k = max(10, min(200, req.k or TOPK_DEFAULT))

    # next_terms: priorité à celles du client, sinon petite anticipation locale
    next_terms = (req.next_terms or [])[:5]
    if not next_terms:
        next_terms = predict_next_terms(q, None, limit=5)

    items = deep_candidates(
        q,
        max(k, RERANK_KEEP) if RERANK_ENABLED else k,
        req.role, req.sector,
        next_terms=next_terms
    )

    # attach top spans (evidence) per item doc (optional)
    enriched = []
    seen_doc_span = {}
    for it in items:
        ev = []
        # one call per doc (cache within request)
        if HAS_SPANS and USE_SPANS:
            if it["doc_id"] not in seen_doc_span:
                seen_doc_span[it["doc_id"]] = best_spans_for(it["doc_id"], q, limit=SPANS_TOP)
            ev = seen_doc_span[it["doc_id"]]
        enriched.append({**it, "evidence": ev})

    return {"ok": True, "anticipated_terms": next_terms, "items": enriched[:k]}

# --------- /compare: evidence matrix across docs ----------
DEFAULT_CRITERIA = [
    "objet/scope", "définitions/références", "pré-requis", "EHS/sécurité",
    "matériel/équipements", "procédure/étapes", "IPC/contrôles",
    "tolérances/paramètres", "fréquences", "responsabilités", "enregistrements"
]

def _criteria_for_topic(topic: str, lang: str) -> List[str]:
    if lang == "en":
        return [
            "scope", "definitions/references", "prerequisites", "EHS/safety",
            "equipment", "procedure/steps", "IPC/controls",
            "tolerances/parameters", "frequencies", "responsibilities", "records"
        ]
    return DEFAULT_CRITERIA

@app.post("/compare")
def compare(req: CompareReq):
    ensure_index()
    topic = normalize_codes(req.topic or "")
    lang = guess_lang(topic)
    crits = req.criteria or _criteria_for_topic(topic, "en" if lang=="en" else "fr")
    kpc = max(1, min(6, req.k_per_crit or 3))

    # For each doc & criterion, fetch top spans or fallback to chunk snippet
    matrix = []
    cover_counts = {doc_id: 0 for doc_id in req.doc_ids}

    for crit in crits:
        row = {"criterion": crit, "docs": []}
        subq = f"{topic} {crit}"
        # we want targeted spans: try spans first for each doc
        for doc_id in req.doc_ids:
            ev = best_spans_for(doc_id, subq, limit=kpc) if (HAS_SPANS and USE_SPANS) else []
            if not ev:
                # fallback: pick best chunk snippet of that doc by our hybrid score
                S = score_hybrid_single(subq, req.role, req.sector)
                # restrict to doc_id
                pairs = []
                for i, r in enumerate(DOCS):
                    if str(r["doc_id"]) == str(doc_id):
                        pairs.append((S[i], i))
                pairs.sort(reverse=True, key=lambda x: x[0])
                top_snips = []
                for sc, i in pairs[:kpc]:
                    r = DOCS[i]
                    top_snips.append({
                        "text": (r.get("content") or "")[:350],
                        "page": r.get("page"), "bbox": None,
                        "chunk_index": r.get("chunk_index"), "span_index": None,
                        "_score": float(sc)
                    })
                ev = top_snips
            cover_counts[doc_id] += int(len(ev) > 0)
            row["docs"].append({"doc_id": doc_id, "evidence": ev})
        matrix.append(row)

    # Simple answerability per doc
    answerability = {doc_id: answerability_label([cover_counts[doc_id]], need=1) for doc_id in req.doc_ids}

    return {
        "ok": True,
        "topic": topic,
        "criteria": crits,
        "matrix": matrix,
        "answerability": answerability
    }

# ---------------- Autostart indexing ----------------
if os.getenv("PYSEARCH_AUTOINDEX", "1").lower() not in ("0", "false", "no"):
    try:
        build_index()
    except Exception as e:
        print(f"[pysearch] Delayed index build (will build on first /search): {e}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=os.getenv("PYSEARCH_HOST", "0.0.0.0"), port=int(os.getenv("PYSEARCH_PORT", "8088")))
