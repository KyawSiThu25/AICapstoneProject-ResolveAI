import React, { useState, useEffect } from 'react';
import { Trash2, X, AlertTriangle } from 'lucide-react';

const BACKEND_API_URL = 'http://localhost:8000/api';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const OPTIONS = [
  { key: 'conversations', label: 'Chats', detail: 'All customer conversations and their messages', defaultOn: true },
  { key: 'bookings', label: 'Calendar bookings', detail: 'Every appointment on the schedule', defaultOn: true },
  { key: 'knowledge', label: 'Knowledge base', detail: 'All documents the AI answers from', defaultOn: false },
  { key: 'catalog', label: 'Services & staff', detail: 'The service menu and team members', defaultOn: false },
] as const;

type OptionKey = typeof OPTIONS[number]['key'];

const DELETED_LABELS: Record<string, string> = {
  conversations: 'chats',
  messages: 'messages',
  bookings: 'bookings',
  knowledge_documents: 'knowledge documents',
  services: 'services',
  staff: 'staff members',
};

const defaults = () =>
  Object.fromEntries(OPTIONS.map(o => [o.key, o.defaultOn])) as Record<OptionKey, boolean>;

export const ResetDataModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const [selected, setSelected] = useState<Record<OptionKey, boolean>>(defaults);
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setSelected(defaults());
      setResult(null);
      setError(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const nothingSelected = !Object.values(selected).some(Boolean);

  const handleReset = async () => {
    setWorking(true);
    setError(null);
    try {
      const res = await fetch(`${BACKEND_API_URL}/admin/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(selected),
      });
      if (!res.ok) {
        setError('The reset failed. Check that the backend is running, then try again.');
        return;
      }
      const data = await res.json();
      const parts = Object.entries(data.deleted as Record<string, number>)
        .map(([k, n]) => `${n} ${DELETED_LABELS[k] || k}`);
      setResult(parts.length ? `Deleted ${parts.join(', ')}.` : 'Nothing to delete.');
    } catch {
      setError('Could not reach the server. Check that the backend is running.');
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 font-serif">
      <div className="bg-white border-4 border-black w-full max-w-md text-black">
        <div className="px-5 py-3 border-b-2 border-black flex items-center justify-between bg-neutral-50">
          <h3 className="font-display font-bold uppercase text-base tracking-tight flex items-center gap-2">
            <Trash2 className="w-4 h-4" /> Reset data
          </h3>
          <button onClick={onClose} className="border border-black p-1 hover:bg-black hover:text-white transition-none cursor-pointer" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {result ? (
          <div className="p-5 space-y-4">
            <p className="text-sm">{result}</p>
            <button
              onClick={onClose}
              className="w-full border-2 border-black bg-black text-white hover:bg-white hover:text-black py-2 font-mono text-xs uppercase font-bold transition-none cursor-pointer"
            >
              Done
            </button>
          </div>
        ) : (
          <div className="p-5 space-y-4">
            <p className="text-sm text-neutral-700">Choose what to delete. AI and calendar settings are kept.</p>

            <div className="space-y-2">
              {OPTIONS.map(o => (
                <label key={o.key} className={`flex items-start gap-3 border-2 p-3 cursor-pointer ${selected[o.key] ? 'border-black' : 'border-neutral-300'}`}>
                  <input
                    type="checkbox"
                    checked={selected[o.key]}
                    onChange={e => setSelected({ ...selected, [o.key]: e.target.checked })}
                    className="accent-black w-4 h-4 mt-0.5 cursor-pointer"
                  />
                  <span>
                    <span className="block font-display font-bold text-sm">{o.label}</span>
                    <span className="block text-xs text-neutral-600">{o.detail}</span>
                  </span>
                </label>
              ))}
            </div>

            <p className="flex items-start gap-2 text-xs text-red-700 font-mono">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              This permanently deletes the selected data and can't be undone.
            </p>
            {error && <p className="font-mono text-xs text-red-700">{error}</p>}

            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="flex-1 border-2 border-black bg-white hover:bg-neutral-100 py-2 font-mono text-xs uppercase font-bold transition-none cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleReset}
                disabled={working || nothingSelected}
                className="flex-1 border-2 border-red-700 bg-red-700 text-white hover:bg-white hover:text-red-700 py-2 font-mono text-xs uppercase font-bold transition-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {working ? 'Deleting…' : 'Delete selected data'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
