# pysearch_service.py
# FastAPI micro-service: Hybrid retrieval for Ask Veeva
# - BM25 + TF-IDF over askv_chunks (joined to askv_documents.filename)
# - Rules for codes (SOP / N2000-2 / IDR) + fuzzy on filenames
# - Optional cross-encoder reranking (Sentence-Transformers)
# - Read-only Postgres access (NEON_DATABASE_URL / DATABASE_URL)
#
# Endpoints:
#   GET  /health              -> status + stats
#   POST /reindex             -> rebuild in-memory indices
#   POST /search {query,k}    -> hybrid search (+ optional rerank)
#
# Env vars:
#   NEON_DATABASE_URL or DATABASE_URL    : Postgres URL
#   PYSEARCH_PORT (default 8088)
#   PYSEARCH_HOST (default 0.0.0.0)
#   PYSEARCH_TOPK (default 60)           : how many items to return by default
#   PYSEARCH_RERANK (default 1)          : 1 = enable cross-encoder rerank, 0 = disabled
#   PYSEARCH_RERANK_MODEL                : cross-encoder model name
#       (default "cross-encoder/ms-marco-MiniLM-L-6-v2")
#   PYSEARCH_RERANK_CAND (default 120)   : first N candidates to rerank
#   PYSEARCH_RERANK_KEEP (default 60)    : keep top K after rerank
#   PYSEARCH_DEVICE (cpu|cuda)           : default auto
#
# Launch:
#   export NEON_DATABASE_URL="postgres://user:pass@host/db?sslmode=require"
#   uvicorn pysearch_service:app --host 0.0.0.0 --port 8088
#
# First run: POST /reindex (or enable auto at service start below)

import os, re, json, time, math
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

# --- Cross-encoder (optional) ---
RERANK_ENABLED = os.getenv("PYSEARCH_RERANK", "1").strip() not in ("0","false","False","no")
RERANK_MODEL_NAME = os.getenv("PYSEARCH_RERANK_MODEL", "cross-encoder/ms-marco-MiniLM-L-6-v2")
RERANK_CAND = int(os.getenv("PYSEARCH_RERANK_CAND", "120"))
RERANK_KEEP = int(os.getenv("PYSEARCH_RERANK_KEEP", "60"))

ce_model = None
ce_device = None
if RERANK_ENABLED:
    try:
        import torch
        from sentence_transformers import CrossEncoder
        dev = os.getenv("PYSEARCH_DEVICE")
        if dev not in ("cpu","cuda"):
            dev = "cuda" if torch.cuda.is_available() else "cpu"
        ce_device = dev
        ce_model = CrossEncoder(RERANK_MODEL_NAME, device=dev)
        print(f"[pysearch] Cross-encoder loaded: {RERANK_MODEL_NAME} on {dev}")
    except Exception as e:
        print(f"[pysearch] WARN: cross-encoder disabled ({e})")
        ce_model = None
        RERANK_ENABLED = False

PG_URL = os.getenv("NEON_DATABASE_URL") or os.getenv("DATABASE_URL")
if not PG_URL:
    print("[pysearch] WARN: no Postgres URL in NEON_DATABASE_URL/DATABASE_URL")

TOPK_DEFAULT = int(os.getenv("PYSEARCH_TOPK", "60"))

# ---------- Code extractors ----------
RE_SOP = re.compile(r"\b(?:QD-?)?SOP[-\s]?([A-Z0-9-]{3,})\b", re.I)
RE_N2000 = re.compile(r"\bN\s?2000[\-_ ]?[-_ ]?2[\-_ ]?[A-Z0-9\-]{2,}\b", re.I)
RE_IDR = re.compile(r"\bIDR[-_ ]?[A-Z0-9\-]{2,}\b", re.I)

def extract_codes(text: str) -> List[str]:
    s = text or ""
    out = set()
    for r in (RE_SOP, RE_N2000, RE_IDR):
        for m in r.findall(s):
            if isinstance(m, tuple):
                for x in m:
                    if x: out.add(str(x))
            else:
                out.add(str(m))
    # full matches (with prefixes)
    for r in (RE_SOP, RE_N2000, RE_IDR):
        for m in r.finditer(s):
            out.add(m.group(0))
    return list(out)

# ---------- Normalization / tokenization ----------
def norm(s: str) -> str:
    s = s or ""
    s = s.replace("\u00A0", " ")
    s = unidecode(s.lower())
    return re.sub(r"\s+", " ", s).strip()

def tokenize(s: str) -> List[str]:
    return re.findall(r"[a-z0-9\-_/\.]+", norm(s))

# ---------- Data holders ----------
DOCS: List[Dict[str, Any]] = []       # each: {chunk_id, doc_id, filename, chunk_index, content}
TOKS: List[List[str]] = []            # tokenized content
FILEN_TOKS: List[List[str]] = []      # filename tokens
CODES: List[List[str]] = []           # extracted codes per doc

BM25: Optional[BM25Okapi] = None
VECT: Optional[TfidfVectorizer] = None
TFIDF = None
IDMAP: Dict[int, int] = {}            # chunk_id -> row index

# ---------- DB helpers ----------
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

# ---------- Indexing ----------
def build_index():
    global DOCS, TOKS, FILEN_TOKS, CODES, BM25, VECT, TFIDF, IDMAP
    t0 = time.time()
    rows = load_chunks()
    DOCS = rows
    IDMAP = {r["chunk_id"]: i for i, r in enumerate(DOCS)}
    TOKS = [tokenize(r["content"] or "") for r in DOCS]
    FILEN_TOKS = [tokenize(r["filename"] or "") for r in DOCS]
    CODES = [extract_codes((r["content"] or "") + " " + (r["filename"] or "")) for r in DOCS]
    BM25 = BM25Okapi(TOKS) if len(DOCS) else None

    # TF-IDF over content + filename (1..3-grams)
    corpus = [norm((r["content"] or "") + " " + (r["filename"] or "")) for r in DOCS]
    if corpus:
        VECT = TfidfVectorizer(ngram_range=(1,3), min_df=2, max_df=0.95)
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

# ---------- Scoring ----------
def score_hybrid(q: str, k: int, role: str|None, sector: str|None):
    if not DOCS:
        return []

    qn = norm(q)
    q_tokens = tokenize(q)
    q_codes = extract_codes(q)

    # 1) BM25
    bm = np.zeros(len(DOCS))
    if BM25:
        bm = np.array(BM25.get_scores(q_tokens))

    # 2) TF-IDF dot (approx cosine)
    tf = np.zeros(len(DOCS))
    if TFIDF is not None and VECT is not None:
        qvec = VECT.transform([qn])
        tf = (TFIDF @ qvec.T).toarray().ravel()

    # 3) filename token overlap
    fname = np.zeros(len(DOCS))
    qset = set(q_tokens)
    for i, ft in enumerate(FILEN_TOKS):
        if not ft: continue
        inter = qset.intersection(ft)
        if inter:
            fname[i] = min(0.4, 0.1 * len(inter))

    # 4) code boosts (exact/fuzzy)
    code_boost = np.zeros(len(DOCS))
    for i, codes in enumerate(CODES):
        if not codes: continue
        for qc in q_codes:
            if qc in codes:
                code_boost[i] += 1.0
            else:
                if any(fuzz.ratio(qc.lower(), c.lower()) >= 90 for c in codes):
                    code_boost[i] += 0.6

    # 5) fuzzy query vs filename
    fuzzy = np.zeros(len(DOCS))
    if len(qn) >= 6:
        for i, r in enumerate(DOCS):
            f = r["filename"] or ""
            if not f: continue
            sc = fuzz.partial_ratio(qn, norm(f))
            if sc >= 90:
                fuzzy[i] = 0.35
            elif sc >= 80:
                fuzzy[i] = 0.2

    # 6) role/sector bias
    rs = np.zeros(len(DOCS))
    rlow = (role or "").lower()
    slow = (sector or "").lower()
    if rlow or slow:
        for i, r in enumerate(DOCS):
            fn = (r["filename"] or "").lower()
            if rlow and rlow in fn: rs[i] += 0.05
            if slow and slow in fn: rs[i] += 0.05

    # weighted sum with z-normalization
    def z(x):
        if x.size == 0: return x
        m = np.mean(x); s = np.std(x) or 1.0
        return (x - m) / s
    S = 0.60*z(bm) + 0.55*z(tf) + fname + code_boost + 0.5*fuzzy + rs

    # top-k indices by score
    kprime = min(max(k, 1), len(S))
    idx = np.argpartition(-S, kprime-1)[:kprime]
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
            "snippet": content[:550]
        })
    return out

# ---------- Cross-encoder reranking (optional) ----------
def rerank_with_cross_encoder(query: str, items: List[Dict[str,Any]], keep: int) -> List[Dict[str,Any]]:
    if not RERANK_ENABLED or ce_model is None or not items:
        return items[:keep]

    # We rerank over the best RERANK_CAND by current score (hybrid)
    pool = items[:min(len(items), RERANK_CAND)]
    pairs = [(query, f"{it['filename']} — {it.get('snippet','')}") for it in pool]

    # batch predict (Cross-Encoder returns relevance score)
    scores = ce_model.predict(pairs, convert_to_numpy=True, show_progress_bar=False)
    # attach score_ce
    for it, sc in zip(pool, scores):
        it["_score_ce"] = float(sc)

    # sort by cross-encoder score desc
    pool.sort(key=lambda x: x.get("_score_ce", 0.0), reverse=True)

    # optionally blend with previous score (lightly)
    # final_score = alpha*ce + (1-alpha)*hybrid; alpha near 0.8 works well
    alpha = 0.8
    for it in pool:
        it["score_final"] = alpha * it.get("_score_ce", 0.0) + (1 - alpha) * float(it.get("score", 0.0))
    pool.sort(key=lambda x: x["score_final"], reverse=True)

    return pool[:keep]

# ---------- FastAPI ----------
class SearchReq(BaseModel):
    query: str
    k: Optional[int] = None
    role: Optional[str] = None
    sector: Optional[str] = None
    rerank: Optional[bool] = None   # override env

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
    k = req.k or TOPK_DEFAULT
    k = max(10, min(200, k))

    # 1) hybrid candidates (k * ~2 to allow rerank top-k to shrink)
    baseK = max(k, RERANK_KEEP) if RERANK_ENABLED else k
    items = score_hybrid(req.query, baseK, req.role, req.sector)

    # 2) optional reranking
    do_rerank = RERANK_ENABLED if (req.rerank is None) else bool(req.rerank)
    if do_rerank:
        items = rerank_with_cross_encoder(req.query, items, keep=max(k, RERANK_KEEP))

    return {"ok": True, "items": items[:k]}

# ---------- Auto reindex at startup (best-effort) ----------
if os.getenv("PYSEARCH_AUTOINDEX", "1") not in ("0","false","False","no"):
    try:
        build_index()
    except Exception as e:
        print(f"[pysearch] Delayed index build (will build on first /search): {e}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=os.getenv("PYSEARCH_HOST", "0.0.0.0"), port=int(os.getenv("PYSEARCH_PORT", "8088")))
