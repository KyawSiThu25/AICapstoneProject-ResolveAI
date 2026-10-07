import os
import re
import chromadb
from typing import List, Dict, Any, Optional

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
CHROMA_DIR = os.path.join(DATA_DIR, "chroma_db")
# Present once default documents have been seeded; delete it to re-seed the demo knowledge
SEED_MARKER = os.path.join(DATA_DIR, ".knowledge_seeded")
os.makedirs(CHROMA_DIR, exist_ok=True)

# Initialize Chroma persistent client
chroma_client = chromadb.PersistentClient(path=CHROMA_DIR)
collection = chroma_client.get_or_create_collection(
    name="company_knowledge",
    metadata={"hnsw:space": "cosine"}
)

DEFAULT_DOCUMENTS = [
    {
        "id": "doc_pricing",
        "title": "Pricing Plans & Tiers",
        "content": (
            "Apex Solutions offers three pricing tiers:\n"
            "1. Starter Plan: $29/month, includes 1,000 monthly AI resolution sessions, 1 human seat, standard email support.\n"
            "2. Professional Plan: $99/month, includes 10,000 AI sessions, 5 human agent seats, calendar integration, priority support.\n"
            "3. Enterprise Plan: Custom pricing, unlimited sessions, dedicated account manager, custom LLM fine-tuning, 99.99% uptime SLA.\n"
            "Annual billing grants a 20% discount on all plans."
        ),
        "category": "Pricing"
    },
    {
        "id": "doc_refunds",
        "title": "Refund & Cancellation Policy",
        "content": (
            "We offer a 14-day no-questions-asked money-back guarantee for all new monthly and annual subscriptions. "
            "To request a refund, customers can speak with our human support team or email billing@apexsolutions.example.com. "
            "Refunds are processed within 3-5 business days back to the original payment method. Cancellations take effect at the end of the billing cycle."
        ),
        "category": "Billing"
    },
    {
        "id": "doc_calendar_meetings",
        "title": "Consultation & Booking Policy",
        "content": (
            "Customers and prospective clients can book a 30-minute Product Consultation or Technical Onboarding session with our team. "
            "Bookings are available Monday through Friday from 09:00 to 17:00 local time. "
            "Our automated AI assistant can directly inspect open calendar slots and schedule appointments into our calendar system without human intervention."
        ),
        "category": "Services"
    },
    {
        "id": "doc_security_privacy",
        "title": "Security, Privacy & Data Compliance",
        "content": (
            "All customer data is encrypted in transit using TLS 1.3 and at rest with AES-256. "
            "We are SOC-2 Type II compliant and GDPR compliant. "
            "Customer chat conversations are never used to train public LLM models without explicit written consent."
        ),
        "category": "Security"
    },
    {
        "id": "doc_handoff",
        "title": "Human Support Escalation",
        "content": (
            "If an issue cannot be resolved by the AI assistant, or if the customer expresses frustration, complex technical bugs, "
            "or explicitly requests a live person, the AI must immediately trigger an agent handoff. "
            "Human agents are on standby during standard business hours (9 AM - 6 PM EST)."
        ),
        "category": "Support"
    }
]

# --- Chunking ---
# The default embedding model (all-MiniLM-L6-v2) only reads ~256 tokens, so long
# documents are split into overlapping chunks that are each embedded separately.
CHUNK_WORDS = 120
OVERLAP_WORDS = 30

def chunk_text(text: str, chunk_words: int = CHUNK_WORDS, overlap_words: int = OVERLAP_WORDS) -> List[str]:
    """Split text into ~chunk_words-word chunks on sentence/line boundaries, overlapping by ~overlap_words."""
    sentences: List[str] = []
    for s in re.split(r"(?<=[.!?])\s+|\n+", text.strip()):
        words = s.split()
        # Hard-split any single "sentence" longer than a chunk
        for i in range(0, len(words), chunk_words):
            piece = " ".join(words[i:i + chunk_words])
            if piece:
                sentences.append(piece)

    chunks: List[str] = []
    current: List[str] = []
    count = 0
    for s in sentences:
        n = len(s.split())
        if current and count + n > chunk_words:
            chunks.append(" ".join(current))
            # Carry trailing sentences forward as overlap so context isn't cut mid-thought
            carry: List[str] = []
            carried = 0
            for prev in reversed(current):
                m = len(prev.split())
                if carried + m > overlap_words:
                    break
                carry.insert(0, prev)
                carried += m
            current, count = carry, carried
        current.append(s)
        count += n
    if current:
        chunks.append(" ".join(current))
    return chunks or [text.strip()]

def _parent_id(record_id: str, metadata: Optional[Dict[str, Any]]) -> str:
    # Records ingested before chunking have no doc_id metadata; they are their own parent
    return (metadata or {}).get("doc_id") or record_id

def _legacy_records() -> List[Dict[str, Any]]:
    data = collection.get()
    return [
        {"id": data["ids"][i], "document": data["documents"][i], "metadata": data["metadatas"][i] or {}}
        for i in range(len(data["ids"]))
        if not (data["metadatas"][i] or {}).get("doc_id")
    ]

def init_rag_store():
    """
    Seed default documents on the very first run only, and re-index any pre-chunking records.
    A marker file records that seeding happened, so a store the business has emptied stays empty.
    """
    if collection.count() == 0:
        if not os.path.exists(SEED_MARKER):
            for doc in DEFAULT_DOCUMENTS:
                add_knowledge_doc(doc["id"], doc["title"], doc["content"], doc["category"])
            print(f"[RAG] Initialized ChromaDB with {len(DEFAULT_DOCUMENTS)} default knowledge documents.")
        else:
            print("[RAG] ChromaDB collection is empty. Add company knowledge from the Vector Store panel.")
    else:
        legacy = _legacy_records()
        for rec in legacy:
            title = rec["metadata"].get("title", rec["id"])
            text = rec["document"]
            # Stored text was "title\ncontent"; strip the title line back off
            if text.startswith(f"{title}\n"):
                text = text[len(title) + 1:]
            add_knowledge_doc(rec["id"], title, text, rec["metadata"].get("category", "General"))
        if legacy:
            print(f"[RAG] Re-indexed {len(legacy)} document(s) into chunks.")
        print(f"[RAG] ChromaDB collection contains {len(list_all_knowledge_docs())} documents ({collection.count()} chunks).")
    if not os.path.exists(SEED_MARKER):
        open(SEED_MARKER, "w").close()

def add_knowledge_doc(doc_id: str, title: str, content: str, category: str = "General"):
    """Chunk, embed, and store a knowledge document in ChromaDB (replacing any previous version)."""
    delete_knowledge_doc(doc_id)
    chunks = chunk_text(content)
    collection.add(
        ids=[f"{doc_id}::c{i}" for i in range(len(chunks))],
        # Prefix each chunk with the title so every chunk carries the document's topic
        documents=[f"{title}\n{chunk}" for chunk in chunks],
        metadatas=[
            {
                "doc_id": doc_id,
                "title": title,
                "category": category,
                "chunk_index": i,
                "chunk_count": len(chunks),
                # Full original text lives on the first chunk so the catalog can show it unchanged
                **({"source_text": content} if i == 0 else {}),
            }
            for i in range(len(chunks))
        ],
    )
    return {"status": "success", "id": doc_id, "chunks": len(chunks)}

def query_knowledge(query_text: str, n_results: int = 3) -> List[Dict[str, Any]]:
    """
    Query ChromaDB for the most relevant documents. Matches are made per chunk, then
    grouped so each document appears once, with its matching chunks in reading order.
    """
    total = collection.count()
    if total == 0:
        return []
    results = collection.query(
        query_texts=[query_text],
        # Over-fetch chunks so n_results distinct documents survive grouping
        n_results=min(n_results * 4, total)
    )
    if not results or not results.get("documents"):
        return []

    grouped: Dict[str, Dict[str, Any]] = {}
    docs = results["documents"][0]
    metadatas = results["metadatas"][0]
    distances = results["distances"][0]
    ids = results["ids"][0]
    for i in range(len(docs)):
        meta = metadatas[i] or {}
        parent = _parent_id(ids[i], meta)
        title = meta.get("title", "")
        text = docs[i][len(title) + 1:] if title and docs[i].startswith(f"{title}\n") else docs[i]
        hit = grouped.setdefault(parent, {
            "id": parent,
            "metadata": {"title": title, "category": meta.get("category", "General")},
            "distance": distances[i],
            "chunks": [],
        })
        hit["distance"] = min(hit["distance"], distances[i])
        hit["chunks"].append((meta.get("chunk_index", 0), text))

    hits = sorted(grouped.values(), key=lambda h: h["distance"])[:n_results]
    for h in hits:
        ordered = [t for _, t in sorted(h.pop("chunks"), key=lambda c: c[0])]
        h["content"] = f"{h['metadata']['title']}\n" + "\n...\n".join(ordered)
    return hits

def list_all_knowledge_docs() -> List[Dict[str, Any]]:
    """Retrieve all stored documents (chunks regrouped into their source document)."""
    data = collection.get()
    docs: Dict[str, Dict[str, Any]] = {}
    for i in range(len(data["ids"])):
        meta = data["metadatas"][i] or {}
        parent = _parent_id(data["ids"][i], meta)
        doc = docs.setdefault(parent, {
            "id": parent,
            "content": "",
            "metadata": {
                "title": meta.get("title"),
                "category": meta.get("category"),
                "chunk_count": meta.get("chunk_count", 1),
            },
        })
        if meta.get("source_text") is not None:
            doc["content"] = meta["source_text"]
        elif not meta.get("doc_id"):
            doc["content"] = data["documents"][i]
    return list(docs.values())

def delete_knowledge_doc(doc_id: str):
    """Delete a document and all of its chunks from ChromaDB."""
    collection.delete(where={"doc_id": doc_id})
    collection.delete(ids=[doc_id])  # pre-chunking records
    return {"status": "deleted", "id": doc_id}
