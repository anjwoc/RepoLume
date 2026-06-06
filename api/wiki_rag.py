"""Wiki RAG (P3): semantic retrieval over the generated wiki documents.

Builds an in-memory FAISS index over the wiki pages using the free/local Ollama embedder,
caches the embedded docs by content hash, and returns the top-k relevant chunks for a
question. Answer generation is delegated to the existing chat streaming path (server.py),
so this module only owns embedding + retrieval.

Mirrors the proven pipeline in api/rag.py / api/data_pipeline.py (LocalDB transformer +
FAISSRetriever) to stay consistent with the rest of the codebase.
"""

import hashlib
import logging
from typing import List, Optional, Tuple

from adalflow.core.types import Document
from adalflow.core.db import LocalDB
from adalflow.components.retriever.faiss_retriever import FAISSRetriever

from api.config import configs
from api.data_pipeline import prepare_data_pipeline
from api.tools.embedder import get_embedder

logger = logging.getLogger(__name__)

# P3 uses the free/local Ollama embedder for the wiki index (user choice).
WIKI_EMBEDDER_TYPE = "ollama"

# content-hash -> transformed documents (with .vector). Survives within the server process.
_doc_cache: dict = {}


def _wiki_hash(pages: List[dict]) -> str:
    h = hashlib.sha256()
    for p in pages:
        h.update(
            (
                str(p.get("id", "")) + "\x00" + str(p.get("title", "")) + "\x00" + str(p.get("content", ""))
            ).encode("utf-8")
        )
    h.update(WIKI_EMBEDDER_TYPE.encode())
    return h.hexdigest()


def _embed_wiki_docs(pages: List[dict]) -> List:
    """Build adalflow Documents from wiki pages and embed them via the standard pipeline."""
    docs: List[Document] = []
    for p in pages:
        content = (p.get("content") or "").strip()
        if not content:
            continue
        docs.append(
            Document(
                text=f"# {p.get('title', '')}\n\n{content}",
                meta_data={"page_id": p.get("id", ""), "title": p.get("title", "")},
            )
        )
    if not docs:
        return []

    transformer = prepare_data_pipeline(embedder_type=WIKI_EMBEDDER_TYPE)
    db = LocalDB()
    db.register_transformer(transformer=transformer, key="split_and_embed")
    db.load(docs)
    db.transform(key="split_and_embed")
    transformed = db.get_transformed_data(key="split_and_embed")

    # Keep only docs with a valid, consistently-sized embedding vector.
    valid = [d for d in transformed if getattr(d, "vector", None) is not None and len(d.vector) > 0]
    if valid:
        target = len(valid[0].vector)
        valid = [d for d in valid if len(d.vector) == target]
    return valid


def _get_wiki_docs(pages: List[dict]) -> List:
    key = _wiki_hash(pages)
    cached = _doc_cache.get(key)
    if cached is not None:
        return cached
    docs = _embed_wiki_docs(pages)
    _doc_cache[key] = docs
    logger.info(f"Wiki RAG: embedded {len(docs)} chunks (hash {key[:8]})")
    return docs


def retrieve_wiki_context(
    pages: List[dict], question: str, top_k: Optional[int] = None
) -> Tuple[str, List[str]]:
    """Return (context_text, cited_page_titles) for the most relevant wiki chunks."""
    docs = _get_wiki_docs(pages)
    if not docs:
        return "", []

    embedder = get_embedder(embedder_type=WIKI_EMBEDDER_TYPE)

    # Ollama embeds one string at a time; ensure the query is always a single string.
    def single_string_embedder(query):
        if isinstance(query, list):
            query = query[0] if query else ""
        return embedder(input=query)

    retriever_kwargs = dict(configs["retriever"])
    if top_k:
        retriever_kwargs["top_k"] = top_k

    retriever = FAISSRetriever(
        **retriever_kwargs,
        embedder=single_string_embedder if WIKI_EMBEDDER_TYPE == "ollama" else embedder,
        documents=docs,
        document_map_func=lambda d: d.vector,
    )

    results = retriever(question)
    chunks: List[str] = []
    titles: List[str] = []
    if results and getattr(results[0], "doc_indices", None):
        for idx in results[0].doc_indices:
            if idx < 0 or idx >= len(docs):
                continue
            d = docs[idx]
            chunks.append(d.text)
            title = (d.meta_data or {}).get("title")
            if title and title not in titles:
                titles.append(title)

    context = "\n\n---\n\n".join(chunks)
    return context, titles
