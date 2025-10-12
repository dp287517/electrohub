# pysearch/pysearch_service.py
# FastAPI micro-service: Deep Hybrid retrieval for Ask Veeva (v4 - "DeepSearch")
# - BM25 + TF-IDF(word) + TF-IDF(char) over askv_chunks (content + filename)
# - Strong normalization (SOP/N####-# variants, IDR)
# - Query expansion:
#     * Dynamic synonyms from DB table askv_synonyms (scalable to thousands of topics)
#     * Lightweight bilingual defaults (FR<->EN) when DB has no hits
# - Global vs Specific intent: query hints + filename heuristics (+ SOP bias)
# - Domain keyword boosts + negative token penalties
# - Optional Cross-Encoder reranking (Sentence-Transformers)
# - MMR diversification to reduce redundancy across chunks
# - Read-only Postgres (NEON_DATABASE_URL / DATABASE_URL)
#
# Endpoints:
#   GET  /health
#   POST /reindex
#   POST /search {query,k,role,sector,rerank}
#
# Launch:
#   uvicorn pysearch_service:app --host 0.0.0.0 --port 8088
# Or:
#   python pysearch_service.py

import os, re, json, time
from typing import List, Dict, Any, Optional, Tuple

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import psycopg2
from psycopg2.extras import RealDictCursor

from unidecode import unidecode
from rapidfuzz import fuzz
from rank_bm25 import BM25Okapi

from sklearn.feature_extraction.text import TfidfVectorizer
import numpy as np

# ------------ Config / env ------------
RERANK_ENABLED = os.getenv("PYSEARCH_RERANK", "1").strip().lower() not in ("0","false","no")
RERANK_MODEL_NAME = os.getenv("PYSEARCH_RERANK_MODEL", "cross-encoder/ms-marco-MiniLM-L-6-v2")
RERANK_CAND = int(os.getenv("PYSEARCH_RERANK_CAND", "120"))
RERANK_KEEP = int(os.getenv("PYSEARCH_RERANK_KEEP", "60"))

PG_URL = os.getenv("NEON_DATABASE_URL") or os.getenv("DATABASE_URL")
TOPK_DEFAULT = int(os.getenv("PYSEARCH_TOPK", "60"))

# Deep search toggles
DEEP_ON = os.getenv("PYSEARCH_DEEP", "1").strip().lower() not in ("0","false","no")
MMR_LAMBDA = float(os.getenv("PYSEARCH_MMR_LAMBDA", "0.7"))   # balance relevance vs diversity
MMR_LIMIT = int(os.getenv("PYSEARCH_MMR_LIMIT", "24"))        # diversify among top-N before truncation

# Small keyword boosts (generic domain words frequently helpful)
KEYWORD_BOOSTS = {
    # FR
    "sop": 0.30, "procédure": 0.25, "procedure": 0.25,
    "déchet": 0.45, "dechet": 0.45, "déchets": 0.45, "waste": 0.35,
    "sécurité": 0.25, "securite": 0.25, "safety": 0.25,
    "maintenance": 0.22, "validation": 0.22, "nettoyage": 0.22, "cleaning": 0.22,
    "checklist": 0.30, "inspection": 0.18, "liste": 0.20, "contrôle": 0.18, "controle": 0.18,
    "idr": 0.55, "format": 0.25, "vignetteuse": 0.40, "neri": 0.20, "notice": 0.18,
    "réglages": 0.22, "reglages": 0.22, "ssol": 0.20, "liq": 0.20, "bulk": 0.15,
    # EN generic
    "vfd": 0.45, "variable": 0.12, "frequency": 0.12, "inverter": 0.22, "drive": 0.16,
    "policy": 0.18, "policies": 0.18, "global": 0.12, "site": 0.10, "plant": 0.10
}

# Lightweight bilingual defaults (used only if DB synonyms don’t return anything)
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

# ------------ Cross-Encoder (optional) ------------
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
        ce_model = CrossEncoder(RERANK_MODEL_NAME, device=dev)
        print(f"[pysearch] Cross-encoder loaded: {RERANK_MODEL_NAME} on {dev}")
    except Exception as e:
        print(f"[pysearch] WARN: cross-encoder disabled ({e})")
        ce_model = None
        RERANK_ENABLED = False

if not PG_URL:
    print("[pysearch] WARN: no Postgres URL in NEON_DATABASE_URL/DATABASE_URL")

# ------------ Patterns / Normalization ------------
# SOP: QD-SOP-038904 / SOP-038904 / SOP 38904 …
RE_SOP_NUM = re.compile(r"\b(?:QD-?)?SOP[-\s]?(\d{4,7})\b", re.I)
RE_SOP_FULL = re.compile(r"\b(?:QD-?)?SOP[-\s]?[A-Z0-9\-]{3,}\b", re.I)

# N####-# (e.g., N2000-2, N1700-1) many variants -> canonical N####-#
RE_NLINE = re.compile(r"\bN?\s*(?P<base>[12]\d{3})\s*(?:-|_|\s)?\s*(?P<suf>\d)\b", re.I)

# IDR token presence (variants: "IDR", "I.D.R", "id r")
RE_IDR = re.compile(r"\bI\.?D\.?R\.?\b", re.I)

def normalize_codes(s: str) -> str:
    """Map common variants to canonical forms."""
    t = s

    # SOP: ensure canonical QD-SOP-XXXXXX when a pure number is seen with SOP
    def _sop_pad(m):
        num = m.group(1)
        num = num.zfill(6) if len(num) <= 6 else num
        return f"QD-SOP-{num}"
    t = RE_SOP_NUM.sub(_sop_pad, t)

    # N####-# fold flexible forms to "N####-#"
    def _nline(m):
        return f"N{m.group('base')}-{m.group('suf')}"
    t = RE_NLINE.sub(_nline, t)

    # Normalize standalone "IDR" variants to "IDR"
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

# Extract codes from text+filename for boosting
def extract_codes(text: str) -> List[str]:
    s = text or ""
    out = set()

    # SOP numbers & full
    for m in RE_SOP_NUM.findall(s):
        out.add(f"QD-SOP-{str(m).zfill(6)}")
    for m in RE_SOP_FULL.findall(s):
        out.add(m)

    # N####-# flex → canonical
    for m in RE_NLINE.finditer(s):
        out.add(f"N{m.group('base')}-{m.group('suf')}")

    # IDR presence
    if RE_IDR.search(s):
        out.add("IDR")

    return list(out)

# Heuristique généralité/specificité des fichiers
def is_general_filename(fn: str) -> bool:
    f = norm(fn)
    has_line_no = bool(re.search(r"\b(91\d{2}|n[12]\d{3}-\d|ligne|line|micro)\b", f))
    is_sop = bool(re.search(r"\b(sop|qd-sop)\b", f))
    has_global = bool(re.search(r"\b(proc(edure|e)|dechet|dechets|waste|global|site|usine|policy|policies)\b", f))
    return (is_sop or has_global) and not has_line_no

def is_specific_filename(fn: str) -> bool:
    f = norm(fn)
    return bool(re.search(r"\b(91\d{2}|n[12]\d{3}-\d|ligne|line|micro|neri|vignetteuse)\b", f))

# Détecte l'intent global / SOP à partir de la requête
def intent_from_query(q: str) -> Tuple[bool,bool]:
    n = norm(q)
    prefer_global = any(w in n for w in ["global", "generale", "générale", "procedure", "procédure", "site", "usine", "policy", "policies"])
    prefer_sop = any(w in n for w in ["sop", "procédure", "procedure", "qd-sop"])
    return prefer_global, prefer_sop

# ------------ Language guess (very light) ------------
FR_HINTS = (" le ", " la ", " les ", " des ", " du ", " de ", " procédure", " déchets", " sécurité", " variateur")
EN_HINTS = (" the ", " and ", " or ", " procedure", " checklist", " safety", " waste", " validation")
def guess_lang(q: str) -> str:
    n = f" {norm(q)} "
    fr = sum(1 for h in FR_HINTS if h in n) + (2 if re.search(r"[éèàùâêîôûç]", q) else 0)
    en = sum(1 for h in EN_HINTS if h in n)
    if fr - en >= 2: return "fr"
    if en - fr >= 2: return "en"
    return "fr"

# ------------ Data holders ------------
DOCS: List[Dict[str, Any]] = []
TOKS: List[List[str]] = []
FILEN_TOKS: List[List[str]] = []
CODES: List[List[str]] = []
ROW_TFIDF: Optional[np.ndarray] = None    # L2-normalized row vectors (word-level)
ROW_CTFIDF: Optional[np.ndarray] = None   # char-level TFIDF rows (optional)

BM25: Optional[BM25Okapi] = None
VECT_WORD: Optional[TfidfVectorizer] = None
TFIDF_WORD = None
VECT_CHAR: Optional[TfidfVectorizer] = None
TFIDF_CHAR = None

# ------------ DB helpers ------------
def db_query(sql: str, params=()):
    conn = psycopg2.connect(PG_URL)
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, params)
            return cur.fetchall()
    finally:
        conn.close()

def load_chunks():
    rows = db_query("""
        SELECT c.id AS chunk_id, c.doc_id, c.chunk_index, c.content, d.filename
        FROM askv_chunks c
        JOIN askv_documents d ON d.id = c.doc_id
        ORDER BY c.id ASC
    """)
    return rows

def fetch_synonyms_for_tokens(tokens: List[str]) -> List[Tuple[str,str,float]]:
    if not tokens:
        return []
    # Match either term or alt_term against tokens (lowercased)
    qs = ",".join(["%s"] * len(tokens))
    sql = f"""
      SELECT term, alt_term, COALESCE(weight,1.0) AS weight
      FROM askv_synonyms
      WHERE LOWER(term) IN ({qs}) OR LOWER(alt_term) IN ({qs})
      LIMIT 500
    """
    params = [t.lower() for t in tokens] + [t.lower() for t in tokens]
    try:
        rows = db_query(sql, params)
        return [(r["term"], r["alt_term"], float(r["weight"])) for r in rows]
    except Exception:
        return []

# ------------ Indexing ------------
def build_index():
    global DOCS, TOKS, FILEN_TOKS, CODES
    global BM25, VECT_WORD, TFIDF_WORD, VECT_CHAR, TFIDF_CHAR
    global ROW_TFIDF, ROW_CTFIDF

    t0 = time.time()

    rows = load_chunks()
    DOCS = rows

    TOKS = [tokenize(r["content"] or "") for r in DOCS]
    FILEN_TOKS = [tokenize(r["filename"] or "") for r in DOCS]
    CODES = [extract_codes((r["content"] or "") + " " + (r["filename"] or "")) for r in DOCS]

    BM25 = BM25Okapi(TOKS) if len(DOCS) else None

    # Build combined text for TF-IDF
    corpus = [norm((r["content"] or "") + " " + (r["filename"] or "")) for r in DOCS]

    if corpus:
        # Word-level TF-IDF (1..3-grams)
        VECT_WORD = TfidfVectorizer(analyzer="word", ngram_range=(1,3), min_df=2, max_df=0.95)
        TFIDF_WORD = VECT_WORD.fit_transform(corpus)

        # Char-level TF-IDF (3..5-grams) for OCR/typos robustness
        VECT_CHAR = TfidfVectorizer(analyzer="char", ngram_range=(3,5), min_df=2, max_df=0.90)
        TFIDF_CHAR = VECT_CHAR.fit_transform(corpus)

        # Precompute L2-normalized rows for MMR similarity
        def l2norm(mat):
            # safe row-wise normalization
            norms = np.sqrt((mat.power(2)).sum(axis=1)).A1 + 1e-12
            inv = 1.0 / norms
            return mat.multiply(inv[:,None])
        ROW_TFIDF = l2norm(TFIDF_WORD)
        ROW_CTFIDF = l2norm(TFIDF_CHAR)
    else:
        VECT_WORD = TFIDF_WORD = None
        VECT_CHAR = TFIDF_CHAR = None
        ROW_TFIDF = ROW_CTFIDF = None

    secs = round(time.time() - t0, 3)
    print(f"[pysearch] indexed docs={len(DOCS)} in {secs}s")
    return {"docs": len(DOCS), "secs": secs}

def ensure_index():
    if not DOCS:
        return build_index()
    return {"docs": len(DOCS), "secs": 0.0}

# ------------ Query expansion (Deep) ------------
def deep_expand_query(raw_q: str) -> str:
    if not DEEP_ON:
        return raw_q
    # Normalize then split tokens (keep originals for phrase-like)
    n = norm(raw_q)
    toks = [t for t in re.findall(r"[a-z0-9\-_/\.]+", n) if t]
    # Pull synonyms from DB
    syns = fetch_synonyms_for_tokens(toks)
    extras = []
    for term, alt, w in syns:
        if alt and alt.lower() not in n:
            # weight influences duplication; we append once, MMR will do the rest
            extras.append(alt)
    # If no DB synonyms found, add a light bilingual default expansion for robustness
    if not extras:
        for fr, en in BILINGUAL_DEFAULTS:
            if fr in n and en not in n:
                extras.append(en)
            elif en in n and fr not in n:
                extras.append(fr)
    if extras:
        return raw_q + " " + " ".join(sorted(set(extras)))
    return raw_q

# ------------ Scoring core ------------
def score_arrays_for_query(q: str) -> Tuple[np.ndarray,np.ndarray,np.ndarray,np.ndarray,np.ndarray,np.ndarray]:
    """
    Returns arrays aligned with DOCS:
      bm, tf_word, tf_char, fname_boost, code_boost, fuzzy
    """
    qn = norm(q)
    q_tokens = tokenize(q)
    q_codes = extract_codes(q)

    # negative tokens: '-term' lower-penalty for filenames containing them
    neg_tokens = [t[1:] for t in q_tokens if t.startswith("-") and len(t) > 1]
    q_tokens = [t for t in q_tokens if not t.startswith("-")]

    # 1) BM25
    bm = np.zeros(len(DOCS))
    if BM25:
        bm = np.array(BM25.get_scores(q_tokens)) if q_tokens else bm

    # 2) TF-IDF (word)
    tf_word = np.zeros(len(DOCS))
    qvec_word = None
    if TFIDF_WORD is not None and VECT_WORD is not None:
        qvec_word = VECT_WORD.transform([qn])
        tf_word = (TFIDF_WORD @ qvec_word.T).toarray().ravel()

    # 3) TF-IDF (char)
    tf_char = np.zeros(len(DOCS))
    qvec_char = None
    if TFIDF_CHAR is not None and VECT_CHAR is not None:
        qvec_char = VECT_CHAR.transform([qn])
        tf_char = (TFIDF_CHAR @ qvec_char.T).toarray().ravel()

    # 4) filename token overlap + keyword boosts + negative token penalty
    fname = np.zeros(len(DOCS))
    qset = set(q_tokens)
    for i, ft in enumerate(FILEN_TOKS):
        if ft:
            inter = qset.intersection(ft)
            if inter:
                fname[i] += min(0.5, 0.12 * len(inter))
            lowfname = " ".join(ft)
            for kw, b in KEYWORD_BOOSTS.items():
                if kw in lowfname:
                    fname[i] += b
            # negative tokens reduce filename score
            for nt in neg_tokens:
                if nt and nt in lowfname:
                    fname[i] -= 0.25

    # 5) code boosts (exact/fuzzy)
    code_boost = np.zeros(len(DOCS))
    for i, codes in enumerate(CODES):
        if not codes:
            continue
        for qc in q_codes:
            if qc in codes:
                code_boost[i] += 1.25
            else:
                if any(fuzz.ratio(qc.lower(), c.lower()) >= 90 for c in codes):
                    code_boost[i] += 0.7

    # 6) fuzzy query vs filename (partial ratio)
    fuzzy = np.zeros(len(DOCS))
    if len(qn) >= 5:
        for i, r in enumerate(DOCS):
            f = r["filename"] or ""
            if not f:
                continue
            sc = fuzz.partial_ratio(qn, norm(f))
            if sc >= 92:
                fuzzy[i] = 0.45
            elif sc >= 84:
                fuzzy[i] = 0.25
            elif sc >= 78:
                fuzzy[i] = 0.12

    return bm, tf_word, tf_char, fname, code_boost, fuzzy

def combine_scores(arrs: List[np.ndarray]) -> np.ndarray:
    def z(x):
        if x.size == 0:
            return x
        m = np.mean(x); s = np.std(x) or 1.0
        return (x - m) / s
    bm, tfw, tfc, fname, code_boost, fuzzy = arrs
    # Blend: BM25 + word TF-IDF weighted; char TF-IDF lightly; others additive
    S = 0.60 * z(bm) + 0.56 * z(tfw) + 0.22 * z(tfc) + fname + code_boost + 0.5 * fuzzy
    return S

def score_hybrid(q: str, k: int, role: Optional[str], sector: Optional[str]):
    if not DOCS:
        return []

    prefer_global, prefer_sop = intent_from_query(q)

    bm, tfw, tfc, fname, code_boost, fuzzy = score_arrays_for_query(q)

    # 6) role/sector bias (soft)
    rs = np.zeros(len(DOCS))
    rlow = (role or "").lower()
    slow = (sector or "").lower()
    if rlow or slow:
        for i, r in enumerate(DOCS):
            fn = (r["filename"] or "").lower()
            if rlow and rlow in fn:
                rs[i] += 0.06
            if slow and slow in fn:
                rs[i] += 0.06

    # 7) global/specific & SOP intent boosts
    intent = np.zeros(len(DOCS))
    for i, r in enumerate(DOCS):
        fn = r["filename"] or ""
        if prefer_global:
            if is_general_filename(fn):
                intent[i] += 0.35
            if is_specific_filename(fn):
                intent[i] -= 0.15
        else:
            if is_specific_filename(fn):
                intent[i] += 0.12
        if prefer_sop and re.search(r"\b(sop|qd-sop)\b", fn, re.I):
            intent[i] += 0.25

    S = combine_scores([bm, tfw, tfc, fname, code_boost, fuzzy]) + rs + intent

    # top-k indices by score
    kprime = min(max(k, 1), len(S))
    idx = np.argpartition(-S, kprime - 1)[:kprime]
    idx = idx[np.argsort(-S[idx])]

    out = []
    for i in idx:
        r = DOCS[i]
        content = (r["content"] or "")
        out.append({
            "chunk_id": r["chunk_id"],
            "doc_id": str(r["doc_id"]),
            "filename": r["filename"],
            "chunk_index": r["chunk_index"],
            "score": float(S[i]),
            "codes": CODES[i],
            "snippet": content[:700]
        })
    return out

# ------------ Deep search orchestration ------------
def mmr_diversify(items: List[Dict[str,Any]], k: int, q: str) -> List[Dict[str,Any]]:
    """
    MMR over TF-IDF WORD rows; fallback to input order if vectors missing.
    """
    if not items or ROW_TFIDF is None or VECT_WORD is None:
        return items[:k]
    # Build matrix of selected rows
    rows = [next((i for i, d in enumerate(DOCS) if d["chunk_id"] == it["chunk_id"]), -1) for it in items]
    rows = [r for r in rows if r >= 0]
    if not rows:
        return items[:k]

    cand_vecs = ROW_TFIDF[rows]  # normalized
    qvec = VECT_WORD.transform([norm(q)])
    # Normalize qvec
    qnorm = np.sqrt((qvec.power(2)).sum()) + 1e-12
    qv = (qvec / qnorm).T

    # Precompute relevance = cosine(q, doc)
    rel = (cand_vecs @ qv).toarray().ravel()

    selected = []
    selected_idx = set()

    # similarity among candidates
    # To compute sim(doc_i, doc_j) ~ cosine using ROW_TFIDF (already normalized)
    sim_mat = (cand_vecs @ cand_vecs.T).toarray()

    # Greedy MMR
    avail = list(range(len(rows)))
    while avail and len(selected) < min(k, len(items), MMR_LIMIT):
        if not selected:
            # pick best relevance
            i_best = int(np.argmax(rel[avail]))
            chosen = avail[i_best]
        else:
            # For each candidate i, mmr = lambda*rel(i) - (1-lambda)*max_j sim(i,j)
            mmr_scores = []
            for idx_cand in avail:
                max_sim = max(sim_mat[idx_cand, j] for j in selected_idx) if selected_idx else 0.0
                mmr = MMR_LAMBDA * rel[idx_cand] - (1 - MMR_LAMBDA) * max_sim
                mmr_scores.append((mmr, idx_cand))
            mmr_scores.sort(reverse=True, key=lambda x: x[0])
            chosen = mmr_scores[0][1]
        selected.append(items[chosen])
        selected_idx.add(chosen)
        avail.remove(chosen)

    return selected[:k]

def deep_candidates(q: str, k: int, role: Optional[str], sector: Optional[str]) -> List[Dict[str,Any]]:
    """
    Multi-pass:
      1) base hybrid
      2) expanded query via synonyms & bilingual defaults
      3) merge + optional MMR diversification
    """
    baseK = max(k, RERANK_KEEP) if RERANK_ENABLED else k
    base = score_hybrid(q, baseK, role, sector)

    if not DEEP_ON:
        return base

    q_expanded = deep_expand_query(q)
    if q_expanded.strip().lower() != q.strip().lower():
        exp = score_hybrid(q_expanded, baseK, role, sector)
    else:
        exp = []

    # merge by unique chunk
    bykey = {}
    for it in base + exp:
        key = (it["chunk_id"])
        prev = bykey.get(key)
        if not prev or float(it["score"]) > float(prev["score"]):
            bykey[key] = it
    merged = list(bykey.values())
    merged.sort(key=lambda x: -float(x["score"]))

    # optional rerank
    return merged

# ------------ Cross-Encoder rerank ------------
def rerank_with_cross_encoder(query: str, items: List[Dict[str, Any]], keep: int) -> List[Dict[str, Any]]:
    if not RERANK_ENABLED or ce_model is None or not items:
        return items[:keep]

    pool = items[:min(len(items), RERANK_CAND)]
    pairs = [(query, f"{it['filename']} — {it.get('snippet','')}") for it in pool]

    scores = ce_model.predict(pairs, convert_to_numpy=True, show_progress_bar=False)
    for it, sc in zip(pool, scores):
        it["_score_ce"] = float(sc)

    # Blend CE score with hybrid a bit (alpha high to favor CE)
    alpha = 0.8
    for it in pool:
        it["score_final"] = alpha * it.get("_score_ce", 0.0) + (1 - alpha) * float(it.get("score", 0.0))
    pool.sort(key=lambda x: x["score_final"], reverse=True)
    return pool[:keep]

# ------------ FastAPI ------------
class SearchReq(BaseModel):
    query: str
    k: Optional[int] = None
    role: Optional[str] = None
    sector: Optional[str] = None
    rerank: Optional[bool] = None
    deep: Optional[bool] = None   # allow client to force deep off/on

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"]
)

@app.get("/health")
def health():
    # optional synonyms count
    syn_count = None
    try:
        r = db_query("SELECT COUNT(*)::int AS n FROM askv_synonyms")
        syn_count = r[0]["n"] if r else 0
    except Exception:
        syn_count = None
    return {
        "ok": True,
        "docs": len(DOCS),
        "bm25": BM25 is not None,
        "tfidf_word": TFIDF_WORD is not None,
        "tfidf_char": TFIDF_CHAR is not None,
        "rerank": bool(RERANK_ENABLED and ce_model is not None),
        "model_ce": RERANK_MODEL_NAME if (RERANK_ENABLED and ce_model is not None) else None,
        "deep": bool(DEEP_ON),
        "mmr": {"lambda": MMR_LAMBDA, "limit": MMR_LIMIT},
        "synonyms": syn_count
    }

@app.post("/reindex")
def reindex():
    info = build_index()
    return {"ok": True, **info}

@app.post("/search")
def search(req: SearchReq):
    ensure_index()
    # Normalize *incoming* query strongly before retrieval
    q = req.query or ""
    q = normalize_codes(q)

    k = req.k or TOPK_DEFAULT
    k = max(10, min(200, k))

    # Deep pipeline
    items = deep_candidates(q, max(k, RERANK_KEEP) if RERANK_ENABLED else k, req.role, req.sector)

    # Optional CE rerank
    do_rerank = RERANK_ENABLED if (req.rerank is None) else bool(req.rerank)
    if do_rerank:
        items = rerank_with_cross_encoder(q, items, keep=max(k, RERANK_KEEP))

    # MMR diversification (after rerank for stability)
    if DEEP_ON and items:
        items = mmr_diversify(items[:max(MMR_LIMIT, k)], k, q)

    return {"ok": True, "items": items[:k]}

# ------------ Autostart indexing ------------
if os.getenv("PYSEARCH_AUTOINDEX", "1").lower() not in ("0", "false", "no"):
    try:
        build_index()
    except Exception as e:
        print(f"[pysearch] Delayed index build (will build on first /search): {e}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=os.getenv("PYSEARCH_HOST", "0.0.0.0"), port=int(os.getenv("PYSEARCH_PORT", "8088")))
