# pysearch/pysearch_service.py
# FastAPI micro-service: Hybrid retrieval for Ask Veeva (v3)
# - BM25 + TF-IDF over askv_chunks (content + filename)
# - Strong normalization (N2000-2 / N20002 / 2000 2 -> N2000-2, SOP variants, IDR)
# - Global vs Specific intent: query hints + filename heuristics
# - SOP intent boost when asking for procedures
# - Domain keyword boosts (IDR, Vignetteuse, Déchets, etc.)
# - Optional Cross-Encoder reranking (Sentence-Transformers)
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
from typing import List, Dict, Any, Optional

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
RERANK_ENABLED = os.getenv("PYSEARCH_RERANK", "1").strip() not in ("0","false","False","no")
RERANK_MODEL_NAME = os.getenv("PYSEARCH_RERANK_MODEL", "cross-encoder/ms-marco-MiniLM-L-6-v2")
RERANK_CAND = int(os.getenv("PYSEARCH_RERANK_CAND", "120"))
RERANK_KEEP = int(os.getenv("PYSEARCH_RERANK_KEEP", "60"))

PG_URL = os.getenv("NEON_DATABASE_URL") or os.getenv("DATABASE_URL")
TOPK_DEFAULT = int(os.getenv("PYSEARCH_TOPK", "60"))

# Small keyword boosts (domain words frequently tied to "good hits")
KEYWORD_BOOSTS = {
    "idr": 0.55,
    "format": 0.25,
    "vignetteuse": 0.40,
    "neri": 0.20,
    "notice": 0.18,
    "réglages": 0.22,
    "reglages": 0.22,
    "ssol": 0.20,
    "liq": 0.20,
    "otri": 0.12,     # racine Otrivin
    "déchet": 0.45,   # déchet / déchets / dechets
    "dechet": 0.45,
    "waste": 0.35,
    "procédure": 0.25,
    "procedure": 0.25,
    "sop": 0.30,
}

# ------------ Cross-Encoder (optional) ------------
ce_model = None
if RERANK_ENABLED:
    try:
        import torch
        from sentence_transformers import CrossEncoder
        dev = os.getenv("PYSEARCH_DEVICE")
        if dev not in ("cpu", "cuda"):
            dev = "cuda" if torch.cuda.is_available() else "cpu"
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

# N2000-2 family: capture many variants  ("N2000-2", "N 2000-2", "N20002", "2000 2", "N-2000 2"...)
RE_N2K_FLEX = re.compile(r"\b(?:N\s*)?(?P<n1>[12]\d{3})\s*(?:-|_|\s)?\s*(?P<n2>[12])\b", re.I)

# Generic N####-# family (e.g., N1700-1) for broader normalization
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

    # N####-# (inclut N2000-2) : fold flexible forms to "N####-#"
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
def intent_from_query(q: str):
    n = norm(q)
    prefer_global = any(w in n for w in ["global", "generale", "générale", "procedure", "procédure", "site", "usine", "policy", "policies"])
    prefer_sop = any(w in n for w in ["sop", "procédure", "procedure", "qd-sop"])
    return prefer_global, prefer_sop

# ------------ Data holders ------------
DOCS: List[Dict[str, Any]] = []
TOKS: List[List[str]] = []
FILEN_TOKS: List[List[str]] = []
CODES: List[List[str]] = []

BM25: Optional[BM25Okapi] = None
VECT: Optional[TfidfVectorizer] = None
TFIDF = None

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

# ------------ Indexing ------------
def build_index():
    global DOCS, TOKS, FILEN_TOKS, CODES, BM25, VECT, TFIDF
    t0 = time.time()

    rows = load_chunks()
    DOCS = rows

    TOKS = [tokenize(r["content"] or "") for r in DOCS]
    FILEN_TOKS = [tokenize(r["filename"] or "") for r in DOCS]

    # Extract codes on (content + filename) at once
    CODES = [extract_codes((r["content"] or "") + " " + (r["filename"] or "")) for r in DOCS]

    BM25 = BM25Okapi(TOKS) if len(DOCS) else None

    # TF-IDF on content + filename; word 1..3-grams
    corpus = [norm((r["content"] or "") + " " + (r["filename"] or "")) for r in DOCS]
    if corpus:
        VECT = TfidfVectorizer(
            analyzer="word",
            ngram_range=(1, 3),
            min_df=2,
            max_df=0.95,
        )
        TFIDF = VECT.fit_transform(corpus)
    else:
        VECT = None
        TFIDF = None

    secs = round(time.time() - t0, 3)
    print(f"[pysearch] indexed docs={len(DOCS)} in {secs}s")
    return {"docs": len(DOCS), "secs": secs}

def ensure_index():
    if not DOCS:
        return build_index()
    return {"docs": len(DOCS), "secs": 0.0}

# ------------ Scoring ------------
def score_hybrid(q: str, k: int, role: Optional[str], sector: Optional[str]):
    if not DOCS:
        return []

    # Normalize incoming query strongly before vectorization/scoring
    qn = norm(q)
    q_tokens = tokenize(q)
    q_codes = extract_codes(q)
    prefer_global, prefer_sop = intent_from_query(q)

    # 1) BM25
    bm = np.zeros(len(DOCS))
    if BM25:
        bm = np.array(BM25.get_scores(q_tokens))

    # 2) TF-IDF dot
    tf = np.zeros(len(DOCS))
    if TFIDF is not None and VECT is not None:
        qvec = VECT.transform([qn])
        tf = (TFIDF @ qvec.T).toarray().ravel()

    # 3) filename token overlap + domain keyword boosts
    fname = np.zeros(len(DOCS))
    qset = set(q_tokens)
    for i, ft in enumerate(FILEN_TOKS):
        if not ft:
            continue
        inter = qset.intersection(ft)
        if inter:
            fname[i] += min(0.5, 0.12 * len(inter))
        lowfname = " ".join(ft)
        for kw, b in KEYWORD_BOOSTS.items():
            if kw in lowfname:
                fname[i] += b

    # 4) code boosts (exact/fuzzy)
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

    # 5) fuzzy query vs filename (partial ratio)
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

    # 7) global/specific & SOP intent boosts based on filename heuristics
    intent = np.zeros(len(DOCS))
    for i, r in enumerate(DOCS):
        fn = r["filename"] or ""
        if prefer_global:
            if is_general_filename(fn):
                intent[i] += 0.35
            if is_specific_filename(fn):
                intent[i] -= 0.15
        else:
            # question semble spécifique: petit avantage aux spécifiques
            if is_specific_filename(fn):
                intent[i] += 0.12
        if prefer_sop and re.search(r"\b(sop|qd-sop)\b", fn, re.I):
            intent[i] += 0.25

    # z-normalize and combine
    def z(x):
        if x.size == 0:
            return x
        m = np.mean(x)
        s = np.std(x) or 1.0
        return (x - m) / s

    S = 0.60 * z(bm) + 0.58 * z(tf) + fname + code_boost + 0.5 * fuzzy + rs + intent

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

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"]
)

@app.get("/health")
def health():
    return {
        "ok": True,
        "docs": len(DOCS),
        "bm25": BM25 is not None,
        "tfidf": TFIDF is not None,
        "rerank": bool(RERANK_ENABLED and ce_model is not None),
        "model_ce": RERANK_MODEL_NAME if (RERANK_ENABLED and ce_model is not None) else None
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

    baseK = max(k, RERANK_KEEP) if RERANK_ENABLED else k
    items = score_hybrid(q, baseK, req.role, req.sector)

    do_rerank = RERANK_ENABLED if (req.rerank is None) else bool(req.rerank)
    if do_rerank:
        items = rerank_with_cross_encoder(q, items, keep=max(k, RERANK_KEEP))

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
