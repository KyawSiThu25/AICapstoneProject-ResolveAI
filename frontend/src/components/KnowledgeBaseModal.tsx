import React, { useState, useEffect } from 'react';
import { Database, Plus, Trash2, X, Layers } from 'lucide-react';

import type { KnowledgeDocument } from '../types';

const BACKEND_API_URL = 'http://localhost:8000/api';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const KnowledgeBaseModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const [docs, setDocs] = useState<KnowledgeDocument[]>([]);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('General');
  const [isAdding, setIsAdding] = useState(false);

  const fetchDocs = async () => {
    try {
      const res = await fetch(`${BACKEND_API_URL}/knowledge`);
      const data = await res.json();
      setDocs(data);
    } catch (err) {
      console.error("Error fetching knowledge docs:", err);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchDocs();
    }
  }, [isOpen]);

  const handleAddDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;

    try {
      const res = await fetch(`${BACKEND_API_URL}/knowledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content, category })
      });
      if (res.ok) {
        setTitle('');
        setContent('');
        setIsAdding(false);
        fetchDocs();
      }
    } catch (err) {
      console.error("Failed to add knowledge document:", err);
    }
  };

  const handleDelete = async (docId: string) => {
    try {
      await fetch(`${BACKEND_API_URL}/knowledge/${docId}`, { method: 'DELETE' });
      fetchDocs();
    } catch (err) {
      console.error("Failed to delete doc:", err);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 font-serif">
      <div className="bg-white border-4 border-black w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden text-black">
        
        {/* Header Bar */}
        <div className="px-6 py-4 border-b-2 border-black flex items-center justify-between bg-neutral-50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-black text-white flex items-center justify-center font-bold">
              <Database className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-display font-bold uppercase text-base tracking-tight text-black flex items-center gap-2">
                ChromaDB Vector Store Catalog
              </h3>
              <p className="font-mono text-xs text-neutral-500 uppercase tracking-wider">
                COLLECTION: company_knowledge // COSINE SIMILARITY
              </p>
            </div>
          </div>
          <button 
            onClick={onClose} 
            className="border border-black p-1 text-black hover:bg-black hover:text-white transition-none cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-white">
          
          {/* Action Row */}
          <div className="flex items-center justify-between border-b-2 border-black pb-3">
            <p className="font-mono text-xs uppercase font-bold text-black flex items-center gap-2">
              <Layers className="w-3.5 h-3.5" />
              <span>
                INDEXED DOCUMENTS ({docs.length}) // {docs.reduce((n, d) => n + (d.metadata?.chunk_count ?? 1), 0)} EMBEDDED CHUNKS
              </span>
            </p>
            <button
              onClick={() => setIsAdding(!isAdding)}
              className="border-2 border-black bg-black text-white hover:bg-white hover:text-black font-mono text-xs uppercase font-bold px-3.5 py-1.5 flex items-center gap-1.5 transition-none cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{isAdding ? 'Close Ingest Dock' : 'Ingest Document'}</span>
            </button>
          </div>

          {/* Add Document Form */}
          {isAdding && (
            <form onSubmit={handleAddDoc} className="border-2 border-black bg-neutral-50 p-4 space-y-3">
              <div className="font-mono text-xs font-bold uppercase tracking-wider text-black border-b border-black pb-1.5">
                Embed New Document Chunk
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <input
                  type="text"
                  placeholder="Document Title (e.g. VIP Enterprise SLA)"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="sm:col-span-2 border-2 border-black bg-white text-black font-serif text-sm px-3 py-2 focus:outline-none"
                  required
                />
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="border-2 border-black bg-white text-black font-mono text-xs uppercase px-3 py-2 focus:outline-none"
                >
                  <option value="General">General</option>
                  <option value="Pricing">Pricing</option>
                  <option value="Billing">Billing</option>
                  <option value="Services">Services</option>
                  <option value="Security">Security</option>
                </select>
              </div>
              <textarea
                placeholder="Plain text content to vectorize into ChromaDB. Long documents are split into ~120-word chunks automatically..."
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={4}
                className="w-full border-2 border-black bg-white text-black font-mono text-xs p-3 leading-relaxed focus:outline-none"
                required
              />
              <button
                type="submit"
                className="border-2 border-black bg-black text-white hover:bg-white hover:text-black font-mono text-xs uppercase font-bold tracking-widest px-6 py-2.5 transition-none cursor-pointer"
              >
                Index &amp; Generate Embeddings →
              </button>
            </form>
          )}

          {/* Documents List */}
          <div className="space-y-4">
            {docs.map((doc) => {
              const meta = doc.metadata || {};
              return (
                <div key={doc.id} className="border-2 border-black bg-white p-4 flex flex-col gap-2.5">
                  <div className="flex items-center justify-between border-b border-black pb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] uppercase font-bold border border-black bg-black text-white px-2 py-0.5">
                        [{meta.category || 'General'}]
                      </span>
                      <h4 className="font-display font-bold uppercase text-sm text-black">
                        {meta.title || doc.id}
                      </h4>
                      <span className="font-mono text-[10px] uppercase text-neutral-500">
                        {meta.chunk_count ?? 1} {(meta.chunk_count ?? 1) === 1 ? 'chunk' : 'chunks'}
                      </span>
                    </div>
                    <button
                      onClick={() => handleDelete(doc.id)}
                      className="border border-black p-1 text-black hover:bg-black hover:text-white transition-none cursor-pointer"
                      title="Delete from vector store"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <p className="font-mono text-xs text-neutral-800 leading-relaxed whitespace-pre-wrap bg-neutral-50 p-3 border border-neutral-300">
                    {doc.content}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
