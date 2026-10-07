import React from 'react';
import { Terminal, ArrowUpRight, MessageSquare } from 'lucide-react';

interface CustomerNavbarProps {
  currentTab?: 'overview' | 'chat';
  onSelectTab?: (tab: 'overview' | 'chat') => void;
  onReport?: () => void;
}

export const CustomerNavbar: React.FC<CustomerNavbarProps> = ({ 
  currentTab = 'overview', 
  onSelectTab,
  onReport
}) => {
  return (
    <header className="sticky top-0 z-40 bg-white border-b-2 border-black px-4 sm:px-8 py-3.5 transition-none text-black shrink-0">
      <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
        {/* Editorial Brand Mark & Title */}
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center bg-black font-display text-lg font-bold text-white shrink-0">
            R
          </span>
          <div>
            <div className="font-mono text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
              RESOLVE AI // DISPATCH
            </div>
            <div className="font-display text-base font-bold tracking-tight text-black truncate">
              Apex Customer Support
            </div>
          </div>
        </div>

        {/* Navigation Tabs (Minimalist Monochrome) */}
        <nav className="flex items-center gap-6 sm:gap-8 font-mono text-xs uppercase tracking-widest font-medium">
          {onSelectTab ? (
            <>
              <button
                type="button"
                onClick={() => onSelectTab('overview')}
                className={`py-1 border-b-2 transition-none ${
                  currentTab === 'overview'
                    ? 'border-black text-black font-bold'
                    : 'border-transparent text-neutral-500 hover:text-black hover:border-black'
                }`}
              >
                Overview
              </button>
              <button
                type="button"
                onClick={() => onSelectTab('chat')}
                className={`flex items-center gap-1.5 py-1 border-b-2 transition-none ${
                  currentTab === 'chat'
                    ? 'border-black text-black font-bold'
                    : 'border-transparent text-neutral-500 hover:text-black hover:border-black'
                }`}
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>Message Us</span>
              </button>
            </>
          ) : (
            <>
              <a href="/" className="py-1 border-b-2 border-black text-black font-bold">Overview</a>
              <a href="/chat" className="py-1 border-b-2 border-transparent text-neutral-500 hover:text-black flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5" />
                <span>Message Us</span>
              </a>
            </>
          )}

          <span className="hidden sm:inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-black border border-black px-2 py-0.5 bg-neutral-50">
            <span className="h-1.5 w-1.5 bg-black" />
            Online
          </span>
        </nav>

        {/* Right Actions: Report & Business Console */}
        <div className="flex items-center gap-2 sm:gap-3">
          {onReport && (
            <button
              type="button"
              onClick={onReport}
              className="h-8 border border-black bg-white px-3 font-mono text-xs font-semibold uppercase tracking-wider text-black hover:bg-black hover:text-white transition-none"
            >
              Report
            </button>
          )}
          <a
            href="http://127.0.0.1:5174"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 border border-black bg-black text-white hover:bg-white hover:text-black px-3 py-1.5 font-mono text-xs font-semibold uppercase tracking-wider transition-none"
            title="Open Internal Support Agent Console on Port 5174"
          >
            <Terminal className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Operations</span>
            <span>(:5174)</span>
            <ArrowUpRight className="w-3 h-3" />
          </a>
        </div>
      </div>
    </header>
  );
};
