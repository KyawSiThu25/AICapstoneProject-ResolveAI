import React from 'react';
import { Terminal, Database, Calendar as CalendarIcon, ArrowUpRight, Cpu, Trash2 } from 'lucide-react';

interface Props {
  onOpenKnowledge: () => void;
  onOpenCalendar: () => void;
  onOpenAiSettings: () => void;
  onOpenReset: () => void;
  stats?: {
    total: number;
    handoff: number;
    ai: number;
    resolved: number;
  };
}

export const BusinessNavbar: React.FC<Props> = ({ 
  onOpenKnowledge, 
  onOpenCalendar, 
  onOpenAiSettings,
  onOpenReset,
  stats
}) => {
  return (
    <header className="h-13 bg-white border-b-2 border-black px-4 sm:px-6 flex items-center justify-between text-black shrink-0 font-serif">
      {/* Brand & Workspace Identity */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 bg-black flex items-center justify-center text-white font-display font-bold">
          <Terminal className="w-4 h-4 text-white" />
        </div>
        <div className="flex items-center gap-2.5">
          <span className="font-display font-bold text-base uppercase tracking-tight text-black">
            Resolve AI
          </span>
          <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-black border border-black px-1.5 py-0.5 bg-neutral-100">
            OPERATIONS :5174
          </span>
        </div>
      </div>

      {/* Inline Live Telemetry Indicators (Zero Vertical Waste) */}
      {stats && (
        <div className="hidden lg:flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider">
          <span className="border border-neutral-300 px-2 py-0.5 bg-neutral-50 text-neutral-700">
            {stats.total} Sessions
          </span>
          <span className={`border px-2 py-0.5 font-bold ${
            stats.handoff > 0 
              ? 'border-black bg-black text-white' 
              : 'border-neutral-300 bg-neutral-50 text-neutral-600'
          }`}>
            {stats.handoff} Needs Attention
          </span>
          <span className="border border-neutral-300 px-2 py-0.5 bg-neutral-50 text-neutral-700">
            {stats.ai} Autonomous AI
          </span>
          <span className="border border-neutral-300 px-2 py-0.5 bg-neutral-50 text-neutral-600">
            {stats.resolved} Resolved
          </span>
        </div>
      )}

      {/* Admin Quick Tools & Customer Portal Link */}
      <div className="flex items-center gap-2 sm:gap-2.5">
        <button
          onClick={onOpenAiSettings}
          className="flex items-center gap-1.5 border border-black bg-white hover:bg-black hover:text-white px-2.5 py-1 font-mono text-xs uppercase tracking-wider text-black transition-none cursor-pointer"
          title="Configure Gemini model, persona prompt, and bot pause window"
        >
          <Cpu className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">AI Settings</span>
        </button>

        <button
          onClick={onOpenKnowledge}
          className="flex items-center gap-1.5 border border-black bg-white hover:bg-black hover:text-white px-2.5 py-1 font-mono text-xs uppercase tracking-wider text-black transition-none cursor-pointer"
          title="Inspect and ingest ChromaDB RAG documents"
        >
          <Database className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Vector Store</span>
        </button>

        <button
          onClick={onOpenCalendar}
          className="flex items-center gap-1.5 border border-black bg-white hover:bg-black hover:text-white px-2.5 py-1 font-mono text-xs uppercase tracking-wider text-black transition-none cursor-pointer"
          title="Inspect appointments booked via AI Tool"
        >
          <CalendarIcon className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Calendar</span>
        </button>

        <button
          onClick={onOpenReset}
          className="flex items-center gap-1.5 border border-red-700 bg-white text-red-700 hover:bg-red-700 hover:text-white px-2.5 py-1 font-mono text-xs uppercase tracking-wider transition-none cursor-pointer"
          title="Delete chats, bookings or other business data"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Reset data</span>
        </button>

        {/* Link back to Customer Side on Port 5173 */}
        <a
          href="http://127.0.0.1:5173"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 border-2 border-black bg-black text-white hover:bg-white hover:text-black px-3 py-1 font-mono text-xs font-bold uppercase tracking-widest transition-none cursor-pointer"
          title="Open Customer Visitor Website on Port 5173"
        >
          <span>Customer Portal (:5173)</span>
          <ArrowUpRight className="w-3.5 h-3.5" />
        </a>
      </div>
    </header>
  );
};
