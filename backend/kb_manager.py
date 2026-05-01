"""
Knowledge Base manager — document upload, chunking, embedding, similarity search.

Two scopes:
  agent_id=None  → app-level KB  (used by the Copilot assistant sidebar)
  agent_id=uuid  → agent-level KB (injected into live call system prompts)

Embeddings use OpenAI text-embedding-3-small (1536-dim).
Requires OPENAI_API_KEY in backend .env.
pgvector must be enabled in Supabase (CREATE EXTENSION vector).
"""
from __future__ import annotations

import io
import logging
from typing import Any

import pdfplumber
from openai import AsyncOpenAI

from config import get_settings
from database import get_db

logger = logging.getLogger(__name__)

CHUNK_SIZE = 500          # characters per chunk
CHUNK_OVERLAP = 80        # overlap between chunks
EMBEDDING_MODEL = "text-embedding-3-small"
EMBED_BATCH = 96          # max texts per embedding API call
MIN_SIMILARITY = 0.30     # discard chunks below this cosine similarity


# ──────────────────────────────────────────────────────────────
# Text helpers
# ──────────────────────────────────────────────────────────────

def _chunk_text(text: str) -> list[str]:
    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = min(start + CHUNK_SIZE, len(text))
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        start += CHUNK_SIZE - CHUNK_OVERLAP
    return chunks


def _extract_text(file_bytes: bytes, filename: str) -> str:
    fn = filename.lower()
    if fn.endswith(".pdf"):
        with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
            pages = [page.extract_text() or "" for page in pdf.pages]
        return "\n\n".join(pages)
    # .txt / .md / anything else — decode as UTF-8
    return file_bytes.decode("utf-8", errors="replace")


# ──────────────────────────────────────────────────────────────
# Embedding
# ──────────────────────────────────────────────────────────────

async def _embed(texts: list[str]) -> list[list[float]]:
    settings = get_settings()
    api_key = settings.openai_api_key
    if not api_key:
        raise ValueError("OPENAI_API_KEY not set in backend .env — required for knowledge base embeddings")
    client = AsyncOpenAI(api_key=api_key)
    all_embeddings: list[list[float]] = []
    for i in range(0, len(texts), EMBED_BATCH):
        batch = texts[i : i + EMBED_BATCH]
        resp = await client.embeddings.create(model=EMBEDDING_MODEL, input=batch)
        all_embeddings.extend(item.embedding for item in resp.data)
    return all_embeddings


# ──────────────────────────────────────────────────────────────
# Public API
# ──────────────────────────────────────────────────────────────

async def upload_document(
    file_bytes: bytes,
    filename: str,
    agent_id: str | None = None,
) -> dict[str, Any]:
    """Parse a PDF/TXT file, chunk it, embed each chunk, and store in Supabase."""
    db = get_db()
    text = _extract_text(file_bytes, filename)
    chunks = _chunk_text(text)
    if not chunks:
        raise ValueError("No text could be extracted from the file")

    # Embed all chunks
    embeddings = await _embed(chunks)

    # Create document record
    doc_row: dict[str, Any] = {
        "name": filename,
        "file_type": "pdf" if filename.lower().endswith(".pdf") else "text",
        "size_bytes": len(file_bytes),
        "chunk_count": len(chunks),
    }
    if agent_id:
        doc_row["agent_id"] = agent_id

    doc_result = db.table("knowledge_documents").insert(doc_row).execute()
    doc_id: str = doc_result.data[0]["id"]

    # Insert chunks in batches
    chunk_rows = []
    for content, embedding in zip(chunks, embeddings):
        row: dict[str, Any] = {
            "document_id": doc_id,
            "content": content,
            "embedding": embedding,
        }
        if agent_id:
            row["agent_id"] = agent_id
        chunk_rows.append(row)

    for i in range(0, len(chunk_rows), 50):
        db.table("knowledge_chunks").insert(chunk_rows[i : i + 50]).execute()

    logger.info(f"KB upload: {filename} → {len(chunks)} chunks (agent_id={agent_id})")
    return {"id": doc_id, "name": filename, "chunk_count": len(chunks)}


async def search_knowledge(
    query: str,
    agent_id: str | None = None,
    limit: int = 4,
) -> list[str]:
    """Embed the query and return the top-k most similar chunks.
    Returns empty list if OPENAI_API_KEY is not set or no KB exists."""
    settings = get_settings()
    if not settings.openai_api_key:
        return []
    try:
        embeddings = await _embed([query])
        query_embedding = embeddings[0]
        db = get_db()
        result = db.rpc(
            "search_knowledge_chunks",
            {
                "query_embedding": query_embedding,
                "match_agent_id": agent_id,
                "match_limit": limit,
            },
        ).execute()
        return [
            row["content"]
            for row in (result.data or [])
            if (row.get("similarity") or 0) >= MIN_SIMILARITY
        ]
    except Exception as e:
        logger.warning(f"KB search skipped: {e}")
        return []


def list_documents(agent_id: str | None = None) -> list[dict[str, Any]]:
    db = get_db()
    q = db.table("knowledge_documents").select(
        "id, name, file_type, size_bytes, chunk_count, created_at"
    )
    if agent_id:
        q = q.eq("agent_id", agent_id)
    else:
        q = q.is_("agent_id", "null")
    return q.order("created_at", desc=True).execute().data or []


def delete_document(doc_id: str) -> None:
    db = get_db()
    # knowledge_chunks cascade via FK, so only need to delete parent
    db.table("knowledge_documents").delete().eq("id", doc_id).execute()
