import React, { useState, useEffect, useRef } from 'react';
import { 
  Bot, UserCheck, CheckCircle2, Send, 
  RefreshCw, MessageSquare, Clock, Search, Calendar as CalendarIcon,
  Mail, Globe,
  PanelRightClose, PanelRightOpen, Database, ShieldCheck, Check, Cpu
} from 'lucide-react';

import type { ConversationSummary, Message } from '../types';

const BACKEND_API_URL = 'http://localhost:8000/api';
const BACKEND_WS_AGENT_URL = 'ws://localhost:8000/ws/agent';

const AGENT_QUICK_SNIPPETS = [
  "Stepping in as live operations specialist to assist you.",
  "Internal records verified. Immediate adjustment applied.",
  "Your consultation schedule has been confirmed on the calendar.",
  "Let me check our corporate licensing documentation for you."
];

interface AgentInboxProps {
  onOpenKnowledge?: () => void;
  onOpenCalendar?: () => void;
  onOpenAiSettings?: () => void;
  onStatsUpdate?: (stats: { total: number; handoff: number; ai: number; resolved: number }) => void;
}

export const AgentInbox: React.FC<AgentInboxProps> = ({ 
  onOpenKnowledge, 
  onOpenCalendar,
  onOpenAiSettings,
  onStatsUpdate 
}) => {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [currentMessages, setCurrentMessages] = useState<Message[]>([]);
  const [replyText, setReplyText] = useState('');
  const [filter, setFilter] = useState<'all' | 'handoff' | 'ai' | 'resolved'>('all');
  const [isConnected, setIsConnected] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showInspector, setShowInspector] = useState(true);

  const socketRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Lets the long-lived WebSocket handler see the current selection without reconnecting
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;

  const fetchConversations = async () => {
    try {
      const res = await fetch(`${BACKEND_API_URL}/conversations`);
      const data: ConversationSummary[] = await res.json();
      setConversations(data);
      if (data.length > 0) {
        setSelectedId(prev => prev ?? data[0].id);
      }

      // Propagate stats
      if (onStatsUpdate) {
        const total = data.length;
        const handoff = data.filter(c => c.status === 'human_handover').length;
        const ai = data.filter(c => c.status === 'ai_active').length;
        const resolved = data.filter(c => c.status === 'resolved').length;
        onStatsUpdate({ total, handoff, ai, resolved });
      }
    } catch (err) {
      console.error("[Agent] Error fetching conversations:", err);
    }
  };

  const fetchMessages = async (convId: string) => {
    try {
      const res = await fetch(`${BACKEND_API_URL}/conversations/${convId}/messages`);
      const data = await res.json();
      setCurrentMessages(data.messages || []);
    } catch (err) {
      console.error("[Agent] Error fetching messages:", err);
    }
  };

  useEffect(() => {
    fetchConversations();
  }, []);

  useEffect(() => {
    if (selectedId) {
      fetchMessages(selectedId);
    }
  }, [selectedId]);

  // WebSocket for real-time agent dashboard sync
  useEffect(() => {
    const ws = new WebSocket(BACKEND_WS_AGENT_URL);
    socketRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        fetchConversations();

        // Status-only events (conversation_updated) just refresh the list above
        if (payload.type === 'new_message' && payload.conversation_id === selectedIdRef.current) {
          setCurrentMessages(prev => [
            ...prev,
            {
              sender: payload.sender,
              content: payload.content,
              created_at: payload.created_at,
              metadata: payload.metadata
            }
          ]);
        }
      } catch (err) {
        console.error("[Agent WebSocket] Parse error:", err);
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
    };

    return () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentMessages]);

  const handleSendReply = async (textToSend?: string) => {
    const text = (textToSend || replyText).trim();
    if (!text || !selectedId) return;

    try {
      const res = await fetch(`${BACKEND_API_URL}/conversations/${selectedId}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text })
      });

      if (res.ok) {
        setReplyText('');
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto';
        }
        // When live, the WebSocket broadcast appends the reply; otherwise reload it
        if (!isConnected) {
          fetchConversations();
          fetchMessages(selectedId);
        }
      }
    } catch (err) {
      console.error("[Agent] Failed to send reply:", err);
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    if (!selectedId) return;
    try {
      await fetch(`${BACKEND_API_URL}/conversations/${selectedId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
      fetchConversations();
    } catch (err) {
      console.error("[Agent] Error changing status:", err);
    }
  };

  const handleResumeAi = async () => {
    if (!selectedId) return;
    try {
      await fetch(`${BACKEND_API_URL}/conversations/${selectedId}/resume-ai`, {
        method: 'POST'
      });
      fetchConversations();
    } catch (err) {
      console.error("[Agent] Error resuming AI:", err);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendReply();
    }
  };

  const filteredConversations = conversations.filter(c => {
    const matchesSearch = c.visitor_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          c.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          (c.visitor_email && c.visitor_email.toLowerCase().includes(searchQuery.toLowerCase())) ||
                          (c.last_message && c.last_message.toLowerCase().includes(searchQuery.toLowerCase()));
    if (!matchesSearch) return false;

    if (filter === 'handoff') return c.status === 'human_handover';
    if (filter === 'ai') return c.status === 'ai_active';
    if (filter === 'resolved') return c.status === 'resolved';
    return true;
  });

  const selectedConversation = conversations.find(c => c.id === selectedId);

  // Bot Pause Window: a future bot_paused_until means the AI resumes on its own at that time;
  // otherwise a handed-off chat waits for an agent to reply or resume the AI.
  const pausedUntil = selectedConversation?.bot_paused_until ? new Date(selectedConversation.bot_paused_until) : null;
  const pauseIsTimed = pausedUntil !== null && pausedUntil.getTime() > Date.now();
  const pauseLabel = pauseIsTimed
    ? `AI paused until ${pausedUntil!.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : 'AI paused until an agent resumes it';

  const totalCount = conversations.length;
  const handoffCount = conversations.filter(c => c.status === 'human_handover').length;
  const aiHandledCount = conversations.filter(c => c.status === 'ai_active').length;
  const resolvedCount = conversations.filter(c => c.status === 'resolved').length;

  // Extract tools or RAG sources executed in current conversation
  const toolsExecuted = Array.from(
    new Set(
      currentMessages
        .map(m => m.metadata?.tool_called)
        .filter((t): t is string => Boolean(t))
    )
  );

  const ragSourcesCited = Array.from(
    new Set(
      currentMessages
        .flatMap(m => m.metadata?.sources || [])
        .filter((s): s is string => Boolean(s))
    )
  );

  return (
    <div className="flex-1 flex min-h-0 bg-white text-black font-serif overflow-hidden">
      
      {/* =========================================================================
          PANE 1: SESSION QUEUE (Elqen Zero Left Rail)
          ========================================================================= */}
      <aside className="w-80 lg:w-[340px] shrink-0 border-r-2 border-black flex flex-col bg-white overflow-hidden">
        
        {/* Rail Header & Search */}
        <div className="p-3 border-b-2 border-black bg-white space-y-2.5 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-display font-bold uppercase text-xs tracking-wider text-black">
                Session Inbox
              </span>
              <span className={`font-mono text-[9px] uppercase font-bold px-1.5 py-0.2 border ${
                isConnected ? 'border-black bg-black text-white' : 'border-neutral-300 text-neutral-500'
              }`}>
                {isConnected ? '● LIVE' : '○ RECONNECTING'}
              </span>
            </div>
            <button
              onClick={fetchConversations}
              className="p-1 border border-black hover:bg-black hover:text-white transition-none cursor-pointer"
              title="Refresh inbox"
            >
              <RefreshCw className="w-3 h-3" />
            </button>
          </div>

          {/* Search Box */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-neutral-400" />
            <input
              type="text"
              placeholder="Search visitor, email, or message..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full border border-black bg-neutral-50 text-black placeholder:text-neutral-400 placeholder:italic font-serif text-xs pl-8 pr-2.5 py-1.5 focus:border-black focus:outline-none"
            />
          </div>

          {/* Triage Filter Segment */}
          <div className="flex border border-black bg-white font-mono text-[10px] uppercase divide-x divide-black">
            <button
              onClick={() => setFilter('all')}
              className={`flex-1 py-1 transition-none ${filter === 'all' ? 'bg-black text-white font-bold' : 'text-neutral-600 hover:text-black'}`}
            >
              All ({totalCount})
            </button>
            <button
              onClick={() => setFilter('handoff')}
              className={`flex-1 py-1 transition-none flex items-center justify-center gap-1 ${
                filter === 'handoff' 
                  ? 'bg-black text-white font-bold' 
                  : handoffCount > 0 
                    ? 'text-black font-bold bg-neutral-100' 
                    : 'text-neutral-600 hover:text-black'
              }`}
            >
              <span>Alert</span>
              <span className="font-bold underline">({handoffCount})</span>
            </button>
            <button
              onClick={() => setFilter('ai')}
              className={`flex-1 py-1 transition-none ${filter === 'ai' ? 'bg-black text-white font-bold' : 'text-neutral-600 hover:text-black'}`}
            >
              AI ({aiHandledCount})
            </button>
            <button
              onClick={() => setFilter('resolved')}
              className={`flex-1 py-1 transition-none ${filter === 'resolved' ? 'bg-black text-white font-bold' : 'text-neutral-600 hover:text-black'}`}
            >
              Done ({resolvedCount})
            </button>
          </div>
        </div>

        {/* Sessions Scroll List */}
        <div className="flex-1 overflow-y-auto divide-y divide-neutral-200">
          {filteredConversations.length === 0 ? (
            <div className="p-8 text-center text-neutral-400 text-xs font-mono uppercase">
              No matching sessions found.
            </div>
          ) : (
            filteredConversations.map((c) => {
              const isSelected = c.id === selectedId;
              const isHandoff = c.status === 'human_handover';
              const isResolved = c.status === 'resolved';

              return (
                <button
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className={`w-full text-left p-3 transition-none flex flex-col gap-1.5 cursor-pointer relative ${
                    isSelected
                      ? 'bg-black text-white'
                      : 'bg-white text-black hover:bg-neutral-50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-display font-bold text-xs uppercase tracking-wide truncate max-w-[170px]">
                      {c.visitor_name}
                    </span>
                    <span className={`text-[10px] font-mono flex items-center gap-1 ${isSelected ? 'text-neutral-400' : 'text-neutral-500'}`}>
                      <Clock className="w-2.5 h-2.5" />
                      {new Date(c.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  {c.visitor_email && (
                    <span className={`text-[10px] font-mono flex items-center gap-1 truncate ${isSelected ? 'text-neutral-300' : 'text-neutral-500'}`}>
                      <Mail className="w-2.5 h-2.5 shrink-0" />
                      {c.visitor_email}
                    </span>
                  )}

                  <p className={`text-xs font-serif truncate w-full ${isSelected ? 'text-neutral-300' : 'text-neutral-600'}`}>
                    {c.last_message ? (
                      <span>
                        <strong className={isSelected ? 'text-white' : 'text-black'}>{c.last_sender || 'user'}:</strong> {c.last_message}
                      </span>
                    ) : (
                      <em className={isSelected ? 'text-neutral-500' : 'text-neutral-400'}>Session initialized...</em>
                    )}
                  </p>

                  <div className="flex items-center gap-1.5 mt-0.5 font-mono text-[9px] uppercase font-bold">
                    {isHandoff ? (
                      <span className={`border px-1.5 py-0.5 ${isSelected ? 'border-white text-white' : 'border-black bg-black text-white'}`}>
                        [NEEDS AGENT]
                      </span>
                    ) : isResolved ? (
                      <span className={`border px-1.5 py-0.5 ${isSelected ? 'border-neutral-500 text-neutral-400' : 'border-neutral-400 text-neutral-600'}`}>
                        [RESOLVED]
                      </span>
                    ) : (
                      <span className={`border px-1.5 py-0.5 ${isSelected ? 'border-neutral-400 text-neutral-300' : 'border-neutral-300 text-neutral-700'}`}>
                        [AI ACTIVE]
                      </span>
                    )}
                    <span className={isSelected ? 'text-neutral-500' : 'text-neutral-400'}>#{c.id.slice(-6)}</span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* =========================================================================
          PANE 2: CONVERSATION COCKPIT (Elqen Zero Center Stream)
          ========================================================================= */}
      <main className="flex-1 flex flex-col min-w-0 bg-white overflow-hidden">
        {selectedConversation ? (
          <>
            {/* Cockpit Top Bar */}
            <div className="h-13 border-b-2 border-black px-4 sm:px-6 flex items-center justify-between bg-white shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-7 h-7 bg-black text-white flex items-center justify-center font-display font-bold text-xs shrink-0">
                  {selectedConversation.visitor_name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="font-display font-bold text-sm uppercase tracking-tight text-black truncate">
                      {selectedConversation.visitor_name}
                    </h2>
                    <span className="font-mono text-[10px] uppercase border border-black px-1.5 py-0.5 bg-neutral-50 text-black hidden sm:inline-flex items-center gap-1">
                      <Globe className="w-2.5 h-2.5" /> Web Terminal
                    </span>
                  </div>
                  <p className="font-mono text-[11px] text-neutral-500 truncate">
                    #{selectedConversation.id} // {selectedConversation.visitor_email || 'No email registered'}
                  </p>
                </div>
              </div>

              {/* Action Toolbar */}
              <div className="flex items-center gap-2 shrink-0">
                {selectedConversation.status === 'human_handover' ? (
                  <button
                    onClick={handleResumeAi}
                    className="border-2 border-black bg-white hover:bg-black hover:text-white px-2.5 py-1 font-mono text-xs font-bold uppercase tracking-wider text-black flex items-center gap-1.5 transition-none cursor-pointer"
                    title="Resume autonomous AI pipeline"
                  >
                    <Bot className="w-3.5 h-3.5" />
                    <span className="hidden md:inline">Return to AI</span>
                  </button>
                ) : (
                  <button
                    onClick={() => handleStatusChange('human_handover')}
                    className="border-2 border-black bg-black text-white hover:bg-white hover:text-black px-2.5 py-1 font-mono text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-none cursor-pointer"
                    title="Pause the AI and take over this conversation"
                  >
                    <UserCheck className="w-3.5 h-3.5" />
                    <span className="hidden md:inline">Takeover</span>
                  </button>
                )}

                {selectedConversation.status !== 'resolved' ? (
                  <button
                    onClick={() => handleStatusChange('resolved')}
                    className="border border-black bg-white hover:bg-black hover:text-white px-2.5 py-1 font-mono text-xs uppercase tracking-wider text-black flex items-center gap-1.5 transition-none cursor-pointer"
                    title="Close and resolve case"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span className="hidden md:inline">Resolve</span>
                  </button>
                ) : (
                  <button
                    onClick={() => handleStatusChange('human_handover')}
                    className="border border-black bg-white hover:bg-black hover:text-white px-2.5 py-1 font-mono text-xs uppercase tracking-wider text-black flex items-center gap-1.5 transition-none cursor-pointer"
                  >
                    Re-open
                  </button>
                )}

                {/* Inspector Toggle */}
                <button
                  onClick={() => setShowInspector(!showInspector)}
                  className="border border-black p-1 text-black hover:bg-black hover:text-white transition-none cursor-pointer ml-1"
                  title={showInspector ? "Hide intelligence panel" : "Show intelligence panel"}
                >
                  {showInspector ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Elqen Bot Pause Window Notification Banner */}
            {selectedConversation.status === 'human_handover' && (
              <div className="bg-black text-white px-4 sm:px-6 py-2 border-b-2 border-black flex items-center justify-between font-mono text-xs uppercase tracking-wider shrink-0">
                <div className="flex items-center gap-2">
                  <UserCheck className="w-3.5 h-3.5" />
                  <span>[BOT PAUSE WINDOW ACTIVE] {pauseLabel}</span>
                </div>
                <button
                  onClick={handleResumeAi}
                  className="underline hover:text-neutral-300 font-bold cursor-pointer text-[11px]"
                >
                  Unpause AI Now →
                </button>
              </div>
            )}

            {/* Message Feed Area */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 bg-neutral-50/40">
              {currentMessages.length === 0 ? (
                <div className="text-center py-16 text-neutral-400 font-mono text-xs uppercase">
                  No conversation history logged for this session yet.
                </div>
              ) : (
                currentMessages.map((msg, idx) => {
                  const isVisitor = msg.sender === 'visitor';
                  const isAgent = msg.sender === 'agent';
                  const isAi = msg.sender === 'ai';

                  return (
                    <div
                      key={idx}
                      className={`flex ${isVisitor ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[85%] sm:max-w-[75%] p-4 border ${
                          isVisitor
                            ? 'bg-black text-white border-black'
                            : isAgent
                            ? 'bg-white text-black border-2 border-black'
                            : 'bg-white text-black border-neutral-300'
                        }`}
                      >
                        {/* Header Tag */}
                        <div className={`font-mono text-[10px] font-bold uppercase tracking-widest mb-1.5 pb-1 border-b flex items-center justify-between ${
                          isVisitor
                            ? 'border-neutral-800 text-neutral-300'
                            : 'border-neutral-200 text-neutral-600'
                        }`}>
                          <span className="flex items-center gap-1.5">
                            {isVisitor && 'VISITOR'}
                            {isAi && (
                              <>
                                <Bot className="w-3 h-3" />
                                <span>AUTONOMOUS AI RESOLUTION</span>
                              </>
                            )}
                            {isAgent && (
                              <>
                                <UserCheck className="w-3 h-3" />
                                <span>OPERATIONS STAFF // MANUAL TAKEOVER</span>
                              </>
                            )}
                          </span>
                          <span>
                            {msg.created_at ? new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                          </span>
                        </div>

                        {/* Message Content */}
                        <p className="whitespace-pre-wrap font-serif text-sm leading-relaxed">
                          {msg.content}
                        </p>

                        {/* RAG Sources Chip */}
                        {msg.metadata?.sources && msg.metadata.sources.length > 0 && (
                          <div className="mt-2.5 pt-2 border-t border-dashed border-neutral-300 font-mono text-[10px] uppercase text-neutral-600 flex flex-wrap gap-1.5 items-center">
                            <span className="font-bold text-black">CITED SOURCES:</span>
                            {msg.metadata.sources.map((s, i) => (
                              <span key={i} className="border border-black bg-neutral-100 text-black px-1.5 py-0.5">
                                [{s}]
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Tool Execution Chip */}
                        {msg.metadata?.tool_called && (
                          <div className="mt-2 pt-1.5 border-t border-dashed border-neutral-300 font-mono text-[10px] uppercase flex items-center gap-1.5 text-neutral-800">
                            <CalendarIcon className="w-3 h-3 text-black shrink-0" />
                            <span>FUNCTION EXECUTED: <strong>{msg.metadata.tool_called}</strong></span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Quick Canned Responses (Elqen Snippets) */}
            <div className="px-4 py-2 border-t border-neutral-300 bg-neutral-50 flex items-center gap-2 overflow-x-auto shrink-0">
              <span className="font-mono text-[10px] uppercase font-bold text-neutral-500 shrink-0">
                SNIPPETS:
              </span>
              {AGENT_QUICK_SNIPPETS.map((snippet, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleSendReply(snippet)}
                  className="whitespace-nowrap border border-neutral-400 bg-white hover:bg-black hover:text-white font-mono text-[11px] px-2.5 py-0.5 text-neutral-800 transition-none cursor-pointer shrink-0"
                >
                  {snippet.slice(0, 42)}... →
                </button>
              ))}
            </div>

            {/* Agent Composer */}
            <form 
              onSubmit={(e) => { e.preventDefault(); handleSendReply(); }} 
              className="p-3 border-t-2 border-black bg-white shrink-0 space-y-2"
            >
              <div className="flex items-end gap-2 border border-black bg-white p-2">
                <textarea
                  ref={textareaRef}
                  rows={2}
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type response as Support Specialist (pauses the AI auto-responder)..."
                  className="flex-1 resize-none bg-transparent font-serif text-sm text-black placeholder:text-neutral-400 placeholder:italic focus:outline-none min-h-[44px]"
                />
                <button
                  type="submit"
                  disabled={!replyText.trim()}
                  className="border-2 border-black bg-black px-4 py-2 font-mono text-xs font-bold uppercase tracking-widest text-white hover:bg-white hover:text-black disabled:bg-neutral-200 disabled:border-neutral-200 disabled:text-neutral-500 transition-none shrink-0 flex items-center gap-1.5 cursor-pointer"
                >
                  <span>Transmit</span>
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="flex items-center justify-between font-mono text-[10px] text-neutral-500 px-1">
                <span>PRESS ENTER TO TRANSMIT // SHIFT+ENTER FOR LINE BREAK</span>
                <span>OUTBOUND REPLY EXTENDS BOT PAUSE WINDOW</span>
              </div>
            </form>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-neutral-400 space-y-3">
            <MessageSquare className="w-10 h-10 text-neutral-300" />
            <p className="font-display text-base font-bold uppercase text-black">
              No Active Conversation Selected
            </p>
            <p className="font-mono text-xs text-neutral-500 max-w-sm">
              Select an inquiry from the session queue on the left to review messages, run RAG grounding, or execute human handoff.
            </p>
          </div>
        )}
      </main>

      {/* =========================================================================
          PANE 3: CUSTOMER & AUTOMATION INSPECTOR (Elqen Zero Right Panel)
          ========================================================================= */}
      {showInspector && selectedConversation && (
        <aside className="w-72 lg:w-80 shrink-0 border-l-2 border-black flex flex-col bg-white overflow-y-auto divide-y-2 divide-black">
          
          {/* Inspector Header */}
          <div className="h-13 px-4 flex items-center justify-between bg-neutral-50 shrink-0">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-black" />
              <span className="font-mono text-xs uppercase font-bold tracking-wider text-black">
                Session Intelligence
              </span>
            </div>
            <button
              onClick={() => setShowInspector(false)}
              className="border border-black p-0.5 hover:bg-black hover:text-white transition-none cursor-pointer"
              title="Close panel"
            >
              <PanelRightClose className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Customer Profile Section */}
          <div className="p-4 space-y-3 bg-white">
            <div className="font-mono text-[10px] uppercase font-bold text-neutral-500 tracking-wider">
              VISITOR PROFILE
            </div>
            
            <div className="space-y-2 font-mono text-xs">
              <div>
                <span className="text-neutral-500 block text-[10px]">NAME</span>
                <span className="font-bold text-black font-display text-sm uppercase">
                  {selectedConversation.visitor_name}
                </span>
              </div>

              <div>
                <span className="text-neutral-500 block text-[10px]">EMAIL ADDRESS</span>
                {selectedConversation.visitor_email ? (
                  <a 
                    href={`mailto:${selectedConversation.visitor_email}`}
                    className="font-bold text-black hover:underline"
                  >
                    {selectedConversation.visitor_email}
                  </a>
                ) : (
                  <span className="text-neutral-400 italic">No email provided</span>
                )}
              </div>

              <div>
                <span className="text-neutral-500 block text-[10px]">SESSION ID</span>
                <span className="text-black bg-neutral-100 px-1.5 py-0.5 border border-neutral-300 block truncate">
                  {selectedConversation.id}
                </span>
              </div>

              <div>
                <span className="text-neutral-500 block text-[10px]">FIRST SEEN</span>
                <span className="text-neutral-700">
                  {new Date(selectedConversation.created_at).toLocaleString()}
                </span>
              </div>
            </div>
          </div>

          {/* Automation & Bot Pause Lifecycle (Elqen Contract) */}
          <div className="p-4 space-y-3 bg-neutral-50">
            <div className="font-mono text-[10px] uppercase font-bold text-neutral-500 tracking-wider">
              AUTOMATION LIFECYCLE
            </div>

            <div className="space-y-2 font-mono text-xs">
              <div className="flex items-center justify-between">
                <span className="text-neutral-600">STATE:</span>
                <span className={`px-2 py-0.5 font-bold uppercase text-[10px] border ${
                  selectedConversation.status === 'human_handover'
                    ? 'border-black bg-black text-white'
                    : selectedConversation.status === 'resolved'
                    ? 'border-neutral-400 text-neutral-500'
                    : 'border-black bg-white text-black'
                }`}>
                  {selectedConversation.status === 'human_handover' ? 'HUMAN HANDOVER' : selectedConversation.status}
                </span>
              </div>

              <div className="p-2.5 bg-white border border-neutral-300 text-[11px] leading-relaxed text-neutral-700">
                {selectedConversation.status === 'human_handover' ? (
                  <>
                    <strong className="text-black block mb-0.5">Bot Pause Window Active</strong>
                    {pauseIsTimed
                      ? `${pauseLabel}, then it resumes automatically. Each reply you send extends the pause.`
                      : 'The visitor asked for a person. The AI stays paused until you reply or resume it.'}
                  </>
                ) : (
                  <>
                    <strong className="text-black block mb-0.5">Autonomous AI Active</strong>
                    Inquiries are answered via ChromaDB RAG and calendar booking tools.
                  </>
                )}
              </div>

              {selectedConversation.status === 'human_handover' ? (
                <button
                  onClick={handleResumeAi}
                  className="w-full border-2 border-black bg-white hover:bg-black hover:text-white py-1.5 font-bold uppercase tracking-wider text-xs transition-none cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <Bot className="w-3.5 h-3.5" />
                  <span>Resume Autonomous Bot</span>
                </button>
              ) : (
                <button
                  onClick={() => handleStatusChange('human_handover')}
                  className="w-full border-2 border-black bg-black text-white hover:bg-white hover:text-black py-1.5 font-bold uppercase tracking-wider text-xs transition-none cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <UserCheck className="w-3.5 h-3.5" />
                  <span>Lock AI &amp; Take Over</span>
                </button>
              )}

              {onOpenAiSettings && (
                <button
                  type="button"
                  onClick={onOpenAiSettings}
                  className="w-full border border-neutral-400 bg-white hover:border-black py-1 text-[11px] font-mono uppercase text-neutral-800 transition-none cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <Cpu className="w-3 h-3 text-neutral-600" />
                  <span>Configure Bot Pause &amp; Model →</span>
                </button>
              )}
            </div>
          </div>

          {/* RAG & Tool Execution Audit */}
          <div className="p-4 space-y-3 bg-white">
            <div className="font-mono text-[10px] uppercase font-bold text-neutral-500 tracking-wider">
              GROUNDING &amp; TOOL AUDIT
            </div>

            <div className="space-y-2.5 font-mono text-xs">
              <div>
                <span className="text-neutral-500 block text-[10px] mb-1">CITED RAG DOCUMENTS</span>
                {ragSourcesCited.length === 0 ? (
                  <span className="text-neutral-400 text-[11px] italic">No documents cited yet</span>
                ) : (
                  <div className="space-y-1">
                    {ragSourcesCited.map((s, idx) => (
                      <div key={idx} className="border border-neutral-300 p-1.5 bg-neutral-50 text-[11px] flex items-center gap-1.5">
                        <Check className="w-3 h-3 text-black shrink-0" />
                        <span className="truncate">{s}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <span className="text-neutral-500 block text-[10px] mb-1">TOOLS INVOKED</span>
                {toolsExecuted.length === 0 ? (
                  <span className="text-neutral-400 text-[11px] italic">No tool calls in session</span>
                ) : (
                  <div className="space-y-1">
                    {toolsExecuted.map((t, idx) => (
                      <div key={idx} className="border border-black p-1.5 bg-black text-white text-[11px] flex items-center gap-1.5 font-bold">
                        <CalendarIcon className="w-3 h-3 shrink-0" />
                        <span>{t}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Operations Shortcuts */}
          <div className="p-4 space-y-2 bg-neutral-50 shrink-0">
            <div className="font-mono text-[10px] uppercase font-bold text-neutral-500 tracking-wider mb-1">
              QUICK AUDIT TOOLS
            </div>

            {onOpenAiSettings && (
              <button
                onClick={onOpenAiSettings}
                className="w-full border-2 border-black bg-black text-white hover:bg-white hover:text-black py-1.5 font-mono text-xs uppercase font-bold flex items-center justify-center gap-2 transition-none cursor-pointer"
              >
                <Cpu className="w-3.5 h-3.5" />
                <span>AI &amp; Automation Settings</span>
              </button>
            )}

            {onOpenKnowledge && (
              <button
                onClick={onOpenKnowledge}
                className="w-full border border-black bg-white hover:bg-black hover:text-white py-1.5 font-mono text-xs uppercase font-bold flex items-center justify-center gap-2 transition-none cursor-pointer"
              >
                <Database className="w-3.5 h-3.5" />
                <span>Vector Store (RAG)</span>
              </button>
            )}

            {onOpenCalendar && (
              <button
                onClick={onOpenCalendar}
                className="w-full border border-black bg-white hover:bg-black hover:text-white py-1.5 font-mono text-xs uppercase font-bold flex items-center justify-center gap-2 transition-none cursor-pointer"
              >
                <CalendarIcon className="w-3.5 h-3.5" />
                <span>Calendar &amp; Staff</span>
              </button>
            )}
          </div>
        </aside>
      )}
    </div>
  );
};
