import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { 
  MessageSquare, X, Send, RotateCcw,
  UserCheck, Calendar, Smile, Paperclip, ArrowLeft, Maximize2
} from 'lucide-react';

import type { Message } from '../types';

const BACKEND_WS_URL = 'ws://localhost:8000/ws/chat';
const BACKEND_API_URL = 'http://localhost:8000/api';

// Shown until the business-specific intro loads from /api/chat/intro
const DEFAULT_GREETING = "Hi there! Ask me anything, or I can book an appointment for you.";
// If no reply has arrived over the socket by then, re-check the conversation over REST
const REPLY_CHECK_MS = 15000;
const REPLY_GIVE_UP_MS = 60000;
const RECONNECT_DELAY_MS = 2000;

interface ChatWidgetProps {
  standalone?: boolean;
  embedded?: boolean;
  onNavigateOverview?: () => void;
  onReport?: () => void;
  onOpenFullChat?: () => void;
}

const formatMessageTime = (isoString?: string) => {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
};

export const ChatWidget: React.FC<ChatWidgetProps> = ({ 
  standalone = false, 
  embedded = false,
  onNavigateOverview,
  onReport,
  onOpenFullChat
}) => {
  const [isOpen, setIsOpen] = useState(standalone);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isAiTyping, setIsAiTyping] = useState(false);
  const [sessionId, setSessionId] = useState<string>('');
  const [isHandedOff, setIsHandedOff] = useState(false);

  // Business-specific intro generated from the knowledge base
  const [greeting, setGreeting] = useState(DEFAULT_GREETING);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [businessName, setBusinessName] = useState('');
  const [openedAt] = useState(() => new Date().toISOString());

  // Visitor identity states
  const [visitorName, setVisitorName] = useState<string>('');
  const [visitorEmail, setVisitorEmail] = useState<string>('');
  const [hasConfirmedDetails, setHasConfirmedDetails] = useState<boolean>(false);
  const [isEditingDetails, setIsEditingDetails] = useState<boolean>(false);
  const [tempName, setTempName] = useState('');
  const [tempEmail, setTempEmail] = useState('');
  const [detailsError, setDetailsError] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Initialize or restore session ID and visitor identity from localStorage
  useEffect(() => {
    let storedId = localStorage.getItem('resolve_chat_session_id');
    if (!storedId) {
      storedId = 'session_' + Math.random().toString(36).substring(2, 9);
      localStorage.setItem('resolve_chat_session_id', storedId);
    }
    setSessionId(storedId);

    const savedName = localStorage.getItem('resolve_chat_visitor_name') || '';
    const savedEmail = localStorage.getItem('resolve_chat_visitor_email') || '';

    if (savedName.trim()) {
      setVisitorName(savedName);
      setTempName(savedName);
      setVisitorEmail(savedEmail);
      setTempEmail(savedEmail);
      setHasConfirmedDetails(true);
    }
  }, []);

  // Load the business greeting and quick-reply suggestions
  useEffect(() => {
    fetch(`${BACKEND_API_URL}/chat/intro`)
      .then(res => res.json())
      .then(data => {
        if (data?.greeting) setGreeting(data.greeting);
        if (Array.isArray(data?.suggestions)) setSuggestions(data.suggestions);
        if (data?.business_name) setBusinessName(data.business_name);
      })
      .catch(err => console.warn("[Chat Intro] Could not load suggestions:", err));
  }, []);

  // Load the stored conversation; also used to catch up on replies missed while disconnected
  const loadHistory = async (id: string): Promise<Message[]> => {
    try {
      const res = await fetch(`${BACKEND_API_URL}/conversations/${id}/messages`);
      const data = await res.json();
      const history: Message[] = data?.messages || [];
      setMessages(history);
      setIsHandedOff(data?.conversation?.status === 'human_handover');
      const last = history[history.length - 1];
      if (last && last.sender !== 'visitor') {
        setIsAiTyping(false);
      }
      if (data?.conversation?.visitor_name && !localStorage.getItem('resolve_chat_visitor_name') && history.length > 0) {
        setVisitorName(data.conversation.visitor_name);
        setTempName(data.conversation.visitor_name);
        if (data.conversation.visitor_email) {
          setVisitorEmail(data.conversation.visitor_email);
          setTempEmail(data.conversation.visitor_email);
        }
        setHasConfirmedDetails(true);
      }
      return history;
    } catch {
      return [];
    }
  };

  // Fetch initial message history if existing
  useEffect(() => {
    if (!sessionId) return;
    loadHistory(sessionId);
  }, [sessionId]);

  // Connect WebSocket, reconnecting automatically if the connection drops
  useEffect(() => {
    if (!sessionId) return;

    let disposed = false;
    let retryTimer: number | undefined;
    let hasConnectedBefore = false;

    const connect = () => {
      const ws = new WebSocket(`${BACKEND_WS_URL}/${sessionId}`);
      socketRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        // After a reconnect, pick up anything sent while we were offline
        if (hasConnectedBefore) loadHistory(sessionId);
        hasConnectedBefore = true;
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'message') {
            setIsAiTyping(false);
            setMessages(prev => [...prev, {
              sender: data.sender,
              content: data.content,
              created_at: data.created_at,
              metadata: data.metadata
            }]);

            if (data.metadata?.handoff_triggered || data.sender === 'agent') {
              setIsHandedOff(true);
            } else if (data.sender === 'ai') {
              setIsHandedOff(false);
            }
          } else if (data.type === 'status') {
            const handedOff = data.status === 'human_handover';
            setIsHandedOff(handedOff);
            if (handedOff) {
              setIsAiTyping(false);
            }
          }
        } catch (err) {
          console.error("[WebSocket] Parse error:", err);
        }
      };

      ws.onclose = () => {
        if (socketRef.current === ws) setIsConnected(false);
        if (!disposed) retryTimer = window.setTimeout(connect, RECONNECT_DELAY_MS);
      };
    };

    connect();

    return () => {
      disposed = true;
      window.clearTimeout(retryTimer);
      socketRef.current?.close();
    };
  }, [sessionId]);

  // Safety net: if the reply doesn't arrive over the socket, re-check the conversation
  useEffect(() => {
    if (!isAiTyping || !sessionId) return;
    const checkTimer = window.setTimeout(() => loadHistory(sessionId), REPLY_CHECK_MS);
    const giveUpTimer = window.setTimeout(() => setIsAiTyping(false), REPLY_GIVE_UP_MS);
    return () => {
      window.clearTimeout(checkTimer);
      window.clearTimeout(giveUpTimer);
    };
  }, [isAiTyping, sessionId]);

  // Auto-resize textarea as user types
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, 28), 160);
    textarea.style.height = `${nextHeight}px`;
  }, [inputText]);

  // Smart auto-scroll
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    container.scrollTo({
      top: container.scrollHeight,
      behavior: 'smooth'
    });
  }, [messages, isAiTyping]);

  // Confirm / Save visitor identity details
  const handleSaveDetails = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!tempName.trim()) {
      setDetailsError("Identity name required.");
      return;
    }

    const cleanName = tempName.trim();
    const cleanEmail = tempEmail.trim() || undefined;

    setVisitorName(cleanName);
    setVisitorEmail(cleanEmail || '');
    setHasConfirmedDetails(true);
    setIsEditingDetails(false);
    setDetailsError(null);

    localStorage.setItem('resolve_chat_visitor_name', cleanName);
    if (cleanEmail) {
      localStorage.setItem('resolve_chat_visitor_email', cleanEmail);
    } else {
      localStorage.removeItem('resolve_chat_visitor_email');
    }

    try {
      await fetch(`${BACKEND_API_URL}/conversations/${sessionId}/visitor-details`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitor_name: cleanName,
          visitor_email: cleanEmail
        })
      });
    } catch (err) {
      console.warn("[Visitor Details] Sync warning:", err);
    }
  };

  // Message sending
  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || inputText).trim();
    if (!text) return;

    if (!hasConfirmedDetails) {
      setIsEditingDetails(true);
      setDetailsError("Register name before sending query.");
      return;
    }

    const activeName = visitorName || 'Website Visitor';
    const activeEmail = visitorEmail || undefined;

    const newMsg: Message = {
      sender: 'visitor',
      content: text,
      created_at: new Date().toISOString()
    };
    setMessages(prev => [...prev, newMsg]);
    setInputText('');

    if (!isHandedOff) {
      setIsAiTyping(true);
    }

    if (textareaRef.current) {
      textareaRef.current.style.height = '28px';
    }

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({
        text: text,
        visitor_name: activeName,
        visitor_email: activeEmail
      }));
    } else {
      try {
        await fetch(`${BACKEND_API_URL}/chat/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: sessionId,
            text: text,
            visitor_name: activeName,
            visitor_email: activeEmail
          })
        });
      } catch (err) {
        console.error("[REST Fallback] Error sending message:", err);
        setIsAiTyping(false);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleResetChat = () => {
    const newId = 'session_' + Math.random().toString(36).substring(2, 9);
    localStorage.setItem('resolve_chat_session_id', newId);
    setSessionId(newId);
    setIsHandedOff(false);
    setIsAiTyping(false);
    setMessages([]);
  };

  // The greeting is shown locally at the top of every conversation; it isn't stored as a message
  const displayMessages: Message[] = [
    { sender: 'ai', content: greeting, created_at: openedAt },
    ...messages
  ];

  // Minimalist Monochrome Chat Panel
  const chatPanel = (
    <section className={`flex flex-col bg-white text-black font-serif ${
      standalone 
        ? 'w-full h-full min-h-0 flex-1 overflow-hidden' 
        : 'w-[440px] h-[640px] max-w-[calc(100vw-32px)] max-h-[calc(100vh-48px)] border-4 border-black bg-white overflow-hidden flex flex-col'
    }`}>
      
      {/* Editorial Header Bar */}
      <div className={`border-b-2 border-black bg-white ${standalone ? 'px-4 sm:px-8 py-4' : 'px-4 py-3'} flex items-center justify-between gap-3 shrink-0`}>
        <div className="flex items-center gap-3 min-w-0">
          {standalone && onNavigateOverview && (
            <button
              type="button"
              onClick={onNavigateOverview}
              className="inline-flex items-center gap-1.5 font-mono text-xs uppercase tracking-wider text-black hover:underline mr-1 cursor-pointer"
              title="Return to Overview"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Overview</span>
            </button>
          )}
          <span className={`flex items-center justify-center bg-black font-display font-bold text-white shrink-0 ${standalone ? 'h-9 w-9 text-base' : 'h-8 w-8 text-sm'}`}>
            R
          </span>
          <div className="min-w-0">
            <h2 className={`truncate font-display font-bold tracking-tight text-black uppercase ${standalone ? 'text-lg' : 'text-sm'}`}>
              {businessName || 'Resolve AI Terminal'}
            </h2>
            <p className="font-mono text-xs text-neutral-500 truncate">
              {hasConfirmedDetails && visitorName ? `LOGGED: ${visitorName}` : 'DISPATCH // AUTOMATED'}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          {standalone && onReport && (
            <button 
              type="button" 
              onClick={onReport} 
              className="border border-black bg-white px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider text-black hover:bg-black hover:text-white transition-none cursor-pointer"
            >
              Report
            </button>
          )}

          {hasConfirmedDetails ? (
            <button 
              type="button" 
              onClick={() => setIsEditingDetails(prev => !prev)} 
              className="border border-black bg-white px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider text-black hover:bg-black hover:text-white transition-none cursor-pointer"
            >
              {isEditingDetails ? "Done" : "Details"}
            </button>
          ) : null}

          <span className="font-mono text-[11px] uppercase font-bold tracking-wider text-black border border-black px-2 py-0.5 bg-neutral-50">
            {isConnected ? "[● Online]" : "[○ Connecting]"}
          </span>

          {!standalone && onOpenFullChat && (
            <button
              type="button"
              onClick={onOpenFullChat}
              title="Expand full screen"
              className="border border-black p-1 text-black hover:bg-black hover:text-white transition-none cursor-pointer"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          )}

          <button 
            type="button"
            onClick={handleResetChat} 
            title="Reset session"
            className="border border-black p-1 text-black hover:bg-black hover:text-white transition-none cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          {!standalone && (
            <button 
              type="button"
              onClick={() => setIsOpen(false)} 
              className="border border-black p-1 text-black hover:bg-black hover:text-white transition-none cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Expandable "Your Details" Drawer */}
      {isEditingDetails && hasConfirmedDetails && (
        <form onSubmit={handleSaveDetails} className="border-b-2 border-black bg-neutral-50 px-4 sm:px-8 py-4 shrink-0">
          <div className={`grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end ${standalone ? 'mx-auto max-w-3xl' : 'w-full'}`}>
            <div>
              <label className="block font-mono text-xs uppercase tracking-wider font-semibold text-black mb-1">
                Name *
              </label>
              <input 
                value={tempName} 
                onChange={(e) => setTempName(e.target.value)} 
                className="w-full border-b-2 border-black bg-white px-3 py-1.5 font-serif text-sm focus:border-b-4 focus:outline-none" 
              />
            </div>
            <div>
              <label className="block font-mono text-xs uppercase tracking-wider font-semibold text-black mb-1">
                Email (Optional)
              </label>
              <input 
                type="email" 
                value={tempEmail} 
                onChange={(e) => setTempEmail(e.target.value)} 
                className="w-full border-b-2 border-black bg-white px-3 py-1.5 font-serif text-sm focus:border-b-4 focus:outline-none" 
              />
            </div>
            <button 
              type="submit" 
              className="border-2 border-black bg-black px-6 py-2 font-mono text-xs font-bold uppercase tracking-widest text-white hover:bg-white hover:text-black transition-none cursor-pointer"
            >
              Save Details
            </button>
          </div>
        </form>
      )}

      {/* Human Handoff Alert Banner */}
      {isHandedOff && (
        <div className="border-b-2 border-black bg-black text-white px-4 sm:px-8 py-2.5 flex items-center justify-between font-mono text-xs uppercase tracking-wider shrink-0">
          <span className="flex items-center gap-2">
            <UserCheck className="w-4 h-4" />
            <span>A team member will reply here shortly</span>
          </span>
          <span className="text-neutral-400 hidden sm:inline">LIVE SUPPORT</span>
        </div>
      )}

      {/* Messages Feed or Initial Identity Drawer */}
      {!hasConfirmedDetails ? (
        <div className="flex flex-1 items-center justify-center p-6 bg-neutral-50">
          <div className="w-full max-w-md border-4 border-black bg-white p-6 sm:p-8">
            <div className="border-b-2 border-black pb-4 mb-6">
              <span className="font-mono text-xs uppercase tracking-widest text-neutral-500 block mb-1">
                IDENTITY VERIFICATION
              </span>
              <h3 className="font-display text-2xl font-bold uppercase tracking-tight text-black">
                Visitor Registration
              </h3>
              <p className="font-serif text-sm text-neutral-600 mt-2 leading-relaxed">
                Provide your name to initialize this support session. Required for audit traceability and handover dispatch.
              </p>
            </div>

            <form onSubmit={handleSaveDetails} className="space-y-4">
              <div>
                <label className="block font-mono text-xs uppercase tracking-wider font-semibold text-black mb-1">
                  Full Name *
                </label>
                <input 
                  required
                  autoComplete="name"
                  value={tempName} 
                  onChange={(e) => setTempName(e.target.value)} 
                  placeholder="e.g. Eleanor Vance" 
                  className="w-full border-b-2 border-black bg-neutral-50 px-3 py-2 font-serif text-sm focus:border-b-4 focus:outline-none placeholder:text-neutral-400 placeholder:italic" 
                />
              </div>

              <div>
                <label className="block font-mono text-xs uppercase tracking-wider font-semibold text-black mb-1">
                  Email Address (Optional)
                </label>
                <input 
                  type="email" 
                  autoComplete="email"
                  value={tempEmail} 
                  onChange={(e) => setTempEmail(e.target.value)} 
                  placeholder="eleanor@domain.com" 
                  className="w-full border-b-2 border-black bg-neutral-50 px-3 py-2 font-serif text-sm focus:border-b-4 focus:outline-none placeholder:text-neutral-400 placeholder:italic" 
                />
              </div>

              {detailsError && (
                <p className="font-mono text-xs text-black border border-black bg-neutral-100 p-2 font-semibold">{detailsError}</p>
              )}

              <button 
                type="submit" 
                disabled={!tempName.trim()}
                className="w-full border-2 border-black bg-black py-3.5 font-mono text-xs font-bold uppercase tracking-widest text-white hover:bg-white hover:text-black disabled:bg-neutral-200 disabled:border-neutral-200 disabled:text-neutral-500 transition-none cursor-pointer mt-2"
              >
                {tempName.trim() ? "Initialize Terminal →" : "Enter Name to Proceed"}
              </button>
            </form>
          </div>
        </div>
      ) : (
        /* Conversation Feed: Minimalist Monochrome Boxes */
        <div ref={scrollRef} className="flex-1 overflow-y-auto bg-neutral-50 px-4 sm:px-8 py-6">
          <div className={`flex flex-col gap-5 ${standalone ? 'mx-auto w-full max-w-3xl' : 'w-full'}`}>
            {displayMessages.map((message, index) => {
              const isVisitor = message.sender === 'visitor';
              const isAgent = message.sender === 'agent';

              return (
                <div
                  key={index}
                  className={`flex ${isVisitor ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={[
                      "max-w-[85%] sm:max-w-[75%] p-5",
                      isVisitor
                        ? "bg-black text-white border-2 border-black"
                        : "bg-white text-black border-2 border-black",
                    ].join(" ")}
                  >
                    {isAgent && (
                      <div className="font-mono text-[10px] font-bold tracking-widest uppercase mb-2 flex items-center gap-1.5 border-b border-black pb-1.5 text-black">
                        <UserCheck className="w-3.5 h-3.5" />
                        <span>LIVE HUMAN AGENT TAKEOVER</span>
                      </div>
                    )}

                    <p className="whitespace-pre-wrap font-serif text-sm sm:text-base leading-relaxed">
                      {message.content}
                    </p>

                    {/* Tool Chip (Monochrome) */}
                    {message.metadata?.tool_called && (
                      <div className="mt-3 pt-2 border-t border-dashed border-neutral-300 font-mono text-[11px] uppercase flex items-center gap-2 bg-neutral-100 p-2 text-black">
                        <Calendar className="w-3.5 h-3.5 text-black shrink-0" />
                        <span>Tool Executed: <strong>{message.metadata.tool_called}</strong></span>
                      </div>
                    )}

                    {/* Sources (Monochrome) */}
                    {message.metadata?.sources && message.metadata.sources.length > 0 && (
                      <div className="mt-3 pt-2 border-t border-dashed border-neutral-300 font-mono text-[10px] uppercase text-neutral-600 flex flex-wrap gap-1.5 items-center">
                        <span className="font-bold text-black">Sources:</span>
                        {message.metadata.sources.map((s, i) => (
                          <span key={i} className="border border-black bg-white text-black px-2 py-0.5 font-mono">
                            [{s}]
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Editorial Timestamp Footer */}
                    <div
                      className={`mt-3 pt-2 border-t font-mono text-[10px] uppercase tracking-widest flex items-center justify-between ${
                        isVisitor ? "border-neutral-800 text-neutral-400" : "border-neutral-200 text-neutral-500"
                      }`}
                    >
                      <span>{isVisitor ? "YOU" : isAgent ? "OPERATIONS" : "SYSTEM"}</span>
                      <span>// {formatMessageTime(message.created_at)}</span>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* AI Typing Indicator */}
            {isAiTyping && (
              <div className="flex justify-start">
                <div className="border-2 border-black bg-white px-4 py-3 font-mono text-xs uppercase tracking-wider text-black flex items-center gap-2">
                  <span className="w-2 h-2 bg-black animate-pulse" />
                  <span>Synthesizing response...</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Quick Prompt Suggestions */}
      {messages.length < 4 && suggestions.length > 0 && !isHandedOff && hasConfirmedDetails && (
        <div className="border-t-2 border-black bg-white px-4 sm:px-8 py-3 shrink-0">
          <div className={`flex flex-wrap gap-2 ${standalone ? 'mx-auto max-w-3xl' : 'w-full'}`}>
            {suggestions.map((prompt, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleSendMessage(prompt)}
                className="border border-black bg-white px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-black hover:bg-black hover:text-white transition-none text-left cursor-pointer"
              >
                {prompt} →
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Pill Composer (Minimalist Monochrome Rectangular Unit) */}
      {hasConfirmedDetails && (
        <form onSubmit={(e) => { e.preventDefault(); handleSendMessage(); }} className="border-t-2 border-black bg-white p-4 sm:p-6 shrink-0">
          <div className={standalone ? 'mx-auto w-full max-w-3xl' : 'w-full'}>
            <div className="flex items-end gap-2 border-2 border-black bg-white p-2 sm:p-3">
              <button
                type="button"
                onClick={() => setInputText(prev => prev + ' [INQUIRY] ')}
                className="border border-black p-2 font-mono text-xs text-black hover:bg-black hover:text-white transition-none shrink-0"
                title="Insert prompt tag"
              >
                <Smile className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={() => alert("Image attachment verification ready.")}
                className="border border-black p-2 font-mono text-xs text-black hover:bg-black hover:text-white transition-none shrink-0"
                title="Attach documentation"
              >
                <Paperclip className="h-4 w-4" />
              </button>

              <textarea
                ref={textareaRef}
                rows={1}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type your inquiry..."
                className="min-h-7 max-h-40 flex-1 resize-none bg-transparent px-2 py-1 font-serif text-sm sm:text-base text-black placeholder:text-neutral-400 placeholder:italic focus:outline-none"
              />

              <button
                type="submit"
                disabled={!inputText.trim()}
                className="border-2 border-black bg-black px-4 py-2 font-mono text-xs font-bold uppercase tracking-widest text-white hover:bg-white hover:text-black disabled:bg-neutral-200 disabled:border-neutral-200 disabled:text-neutral-500 transition-none shrink-0 flex items-center gap-1.5 cursor-pointer"
                aria-label="Send message"
              >
                <span className="hidden sm:inline">Transmit</span>
                <Send className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="mt-2.5 flex items-center justify-between font-mono text-[11px] text-neutral-500 px-1">
              <span>DISPATCH ENGINE ACTIVE</span>
              <span className="hidden sm:inline">ENTER: TRANSMIT // SHIFT+ENTER: LINE</span>
            </div>
          </div>
        </form>
      )}
    </section>
  );

  // Standalone Full-Page Mode
  if (standalone) {
    return (
      <div className={`w-full flex-1 flex flex-col bg-white overflow-hidden ${embedded ? 'h-screen' : 'h-full min-h-0'}`}>
        {chatPanel}
      </div>
    );
  }

  // Floating Trigger & Drawer (Minimalist Monochrome)
  return (
    <div className="fixed bottom-8 right-8 z-50">
      {!isOpen && (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="border-2 border-black bg-black text-white px-6 py-4 font-mono text-xs font-bold uppercase tracking-widest hover:bg-white hover:text-black transition-none cursor-pointer flex items-center gap-3"
        >
          <span className="flex h-5 w-5 items-center justify-center bg-white text-black font-bold">
            <MessageSquare className="w-3.5 h-3.5" />
          </span>
          <span>Open Chat Terminal</span>
        </button>
      )}

      {isOpen && chatPanel}
    </div>
  );
};
