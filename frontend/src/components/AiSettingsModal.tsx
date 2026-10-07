import React, { useState, useEffect } from 'react';
import { 
  Cpu, X, Check, AlertCircle, RefreshCw, 
  Sparkles, Sliders, Clock, Key
} from 'lucide-react';

import type { AiSettings } from '../types';

const BACKEND_API_URL = 'http://localhost:8000/api';

const MODEL_OPTIONS = [
  { id: 'gemini-3.5-flash', description: 'Recommended. Strong reasoning and reliable tool calling for bookings.' },
  { id: 'gemini-3.5-flash-lite', description: 'Fastest replies and lowest cost. Good for simple FAQ-style questions.' },
  { id: 'gemini-2.5-flash', description: 'Previous generation. Kept as a backup model.' },
];

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const AiSettingsModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<'model' | 'persona' | 'automation'>('model');
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newApiKey, setNewApiKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; latency_ms?: number; reply?: string; error?: string; model?: string } | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Form State
  const [businessName, setBusinessName] = useState('');
  const [model, setModel] = useState('gemini-2.5-flash');
  const [temperature, setTemperature] = useState(0.2);
  const [maxTokens, setMaxTokens] = useState(600);
  const [systemInstruction, setSystemInstruction] = useState('');
  const [pauseMinutes, setPauseMinutes] = useState(30);
  const [handoffKeywordsStr, setHandoffKeywordsStr] = useState('');
  const [ragTopK, setRagTopK] = useState(2);
  const [strictGrounding, setStrictGrounding] = useState(true);
  const [enableCalendar, setEnableCalendar] = useState(true);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND_API_URL}/settings/ai`);
      if (res.ok) {
        const data: AiSettings = await res.json();
        setSettings(data);
        setBusinessName(data.business_name || '');
        setModel(data.model || 'gemini-2.5-flash');
        setTemperature(data.temperature ?? 0.2);
        setMaxTokens(data.max_output_tokens ?? 600);
        setSystemInstruction(data.system_instruction || '');
        setPauseMinutes(data.bot_pause_duration_minutes ?? 30);
        setHandoffKeywordsStr((data.handoff_keywords || []).join(', '));
        setRagTopK(data.rag_top_k ?? 2);
        setStrictGrounding(data.strict_grounding ?? true);
        setEnableCalendar(data.enable_calendar_tool ?? true);
      }
    } catch (err) {
      console.error("[AiSettings] Error fetching settings:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchSettings();
      setTestResult(null);
      setSaveSuccess(false);
      setNewApiKey('');
    }
  }, [isOpen]);

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`${BACKEND_API_URL}/settings/ai/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: newApiKey.trim() || undefined,
          model: model
        })
      });
      const data = await res.json();
      setTestResult(data);
    } catch (err: any) {
      setTestResult({ success: false, error: err.message });
    } finally {
      setTesting(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveSuccess(false);

    const keywords = handoffKeywordsStr
      .split(',')
      .map(k => k.trim().toLowerCase())
      .filter(Boolean);

    const payload: any = {
      business_name: businessName.trim(),
      model,
      temperature,
      max_output_tokens: maxTokens,
      system_instruction: systemInstruction,
      bot_pause_duration_minutes: pauseMinutes,
      handoff_keywords: keywords,
      rag_top_k: ragTopK,
      strict_grounding: strictGrounding,
      enable_calendar_tool: enableCalendar
    };

    if (newApiKey.trim()) {
      payload.api_key = newApiKey.trim();
    }

    try {
      const res = await fetch(`${BACKEND_API_URL}/settings/ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        const updated: AiSettings = await res.json();
        setSettings(updated);
        setNewApiKey('');
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
      }
    } catch (err) {
      console.error("[AiSettings] Error saving settings:", err);
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 font-serif">
      <div className="bg-white border-4 border-black w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden text-black">
        
        {/* Header Bar */}
        <div className="px-6 py-4 border-b-2 border-black flex items-center justify-between bg-neutral-50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-black text-white flex items-center justify-center font-bold">
              <Cpu className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-display font-bold uppercase text-base tracking-tight text-black flex items-center gap-2">
                AI &amp; Automation Engine Configuration
              </h3>
              <p className="font-mono text-xs text-neutral-500 uppercase tracking-wider">
                ELQEN ZERO WORKSPACE PROTOCOL // GEMINI PIPELINE
              </p>
            </div>
          </div>
          <button 
            onClick={onClose} 
            className="border border-black p-1 text-black hover:bg-black hover:text-white transition-none cursor-pointer"
            aria-label="Close settings"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigation Segment */}
        <div className="flex border-b-2 border-black bg-neutral-100 font-mono text-xs uppercase font-bold divide-x-2 divide-black shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('model')}
            className={`flex-1 py-2.5 px-4 flex items-center justify-center gap-2 transition-none cursor-pointer ${
              activeTab === 'model' ? 'bg-white text-black border-b-2 border-white -mb-0.5' : 'text-neutral-600 hover:text-black'
            }`}
          >
            <Key className="w-3.5 h-3.5" />
            <span>1. Model &amp; Engine</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('persona')}
            className={`flex-1 py-2.5 px-4 flex items-center justify-center gap-2 transition-none cursor-pointer ${
              activeTab === 'persona' ? 'bg-white text-black border-b-2 border-white -mb-0.5' : 'text-neutral-600 hover:text-black'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>2. Persona &amp; Grounding</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('automation')}
            className={`flex-1 py-2.5 px-4 flex items-center justify-center gap-2 transition-none cursor-pointer ${
              activeTab === 'automation' ? 'bg-white text-black border-b-2 border-white -mb-0.5' : 'text-neutral-600 hover:text-black'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>3. Automations &amp; Pause</span>
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSaveSettings} className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-white">
            
            {/* ==============================================================
                TAB 1: MODEL & ENGINE
                ============================================================== */}
            {activeTab === 'model' && (
              <div className="space-y-6">
                
                {/* Active Key Status & Config */}
                <div className="border-2 border-black p-4 bg-neutral-50 space-y-3">
                  <div className="flex items-center justify-between border-b border-black pb-2">
                    <span className="font-mono text-xs uppercase font-bold text-black flex items-center gap-2">
                      <Key className="w-3.5 h-3.5" />
                      <span>Google AI Studio Key</span>
                    </span>
                    <span className={`font-mono text-[10px] uppercase font-bold px-2 py-0.5 border ${
                      settings?.has_api_key 
                        ? 'border-black bg-black text-white' 
                        : 'border-red-600 bg-red-100 text-red-800'
                    }`}>
                      {settings?.has_api_key ? '[● KEY CONFIGURED]' : '[○ KEY MISSING]'}
                    </span>
                  </div>

                  <div className="font-mono text-xs text-neutral-600">
                    CURRENT KEY: <strong className="text-black">{settings?.api_key_masked || 'None configured'}</strong>
                  </div>

                  <div>
                    <label className="block font-mono text-xs uppercase font-semibold text-black mb-1">
                      Update API Key (Leaves untouched if empty):
                    </label>
                    <input
                      type="password"
                      placeholder="Paste new Gemini API Key (e.g. AIzaSy... or AQ....)"
                      value={newApiKey}
                      onChange={(e) => setNewApiKey(e.target.value)}
                      className="w-full border-2 border-black bg-white px-3 py-2 font-mono text-xs focus:outline-none"
                    />
                  </div>

                  {/* Test Connection Button */}
                  <div className="flex items-center gap-3 pt-1">
                    <button
                      type="button"
                      onClick={handleTestConnection}
                      disabled={testing}
                      className="border border-black bg-white hover:bg-black hover:text-white font-mono text-xs uppercase font-bold px-3 py-1.5 flex items-center gap-2 transition-none cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3 h-3 ${testing ? 'animate-spin' : ''}`} />
                      <span>{testing ? 'Pinging Gemini...' : 'Test Connection'}</span>
                    </button>

                    {testResult && (
                      <span className={`font-mono text-xs flex items-center gap-1.5 ${
                        testResult.success ? 'text-black font-bold' : 'text-red-700 font-bold'
                      }`}>
                        {testResult.success ? (
                          <>
                            <Check className="w-3.5 h-3.5" />
                            <span>Connected ({testResult.latency_ms}ms) // {testResult.model}</span>
                          </>
                        ) : (
                          <>
                            <AlertCircle className="w-3.5 h-3.5" />
                            <span>Failed: {testResult.error?.slice(0, 50)}</span>
                          </>
                        )}
                      </span>
                    )}
                  </div>
                </div>

                {/* Model Selector */}
                <div className="space-y-3">
                  <label className="block font-mono text-xs uppercase font-bold text-black">
                    Primary LLM Model
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {MODEL_OPTIONS.map((option) => {
                      const isActive = model === option.id;
                      return (
                        <label
                          key={option.id}
                          onClick={() => setModel(option.id)}
                          className={`border-2 p-3.5 flex flex-col justify-between cursor-pointer transition-none ${
                            isActive
                              ? 'border-black bg-black text-white'
                              : 'border-neutral-300 bg-white text-black hover:border-black'
                          }`}
                        >
                          <div>
                            <div className="font-mono text-xs font-bold uppercase tracking-wider flex items-center justify-between gap-2">
                              <span>{option.id}</span>
                              {isActive && <span>[ACTIVE]</span>}
                            </div>
                            <p className={`font-serif text-xs mt-1.5 ${isActive ? 'text-neutral-300' : 'text-neutral-600'}`}>
                              {option.description}
                            </p>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                  <p className="font-mono text-[10px] text-neutral-500">
                    If the selected model hits its quota or is unavailable, the other models are tried automatically.
                  </p>
                </div>

                {/* Hyperparameters */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="border border-black p-3.5 space-y-2">
                    <div className="flex items-center justify-between font-mono text-xs uppercase font-bold text-black">
                      <span>Temperature</span>
                      <span>{temperature}</span>
                    </div>
                    <input
                      type="range"
                      min="0.0"
                      max="1.0"
                      step="0.05"
                      value={temperature}
                      onChange={(e) => setTemperature(parseFloat(e.target.value))}
                      className="w-full accent-black cursor-pointer"
                    />
                    <p className="font-mono text-[10px] text-neutral-500">
                      0.0 = Grounded &amp; deterministic; 1.0 = Highly conversational
                    </p>
                  </div>

                  <div className="border border-black p-3.5 space-y-2">
                    <div className="flex items-center justify-between font-mono text-xs uppercase font-bold text-black">
                      <span>Max Output Tokens</span>
                      <span>{maxTokens}</span>
                    </div>
                    <select
                      value={maxTokens}
                      onChange={(e) => setMaxTokens(parseInt(e.target.value))}
                      className="w-full border border-black bg-white px-2 py-1 font-mono text-xs uppercase focus:outline-none"
                    >
                      <option value="300">300 Tokens (Concise answers)</option>
                      <option value="600">600 Tokens (Standard support)</option>
                      <option value="1200">1200 Tokens (Detailed breakdowns)</option>
                    </select>
                    <p className="font-mono text-[10px] text-neutral-500">
                      Caps response length for visitor readability
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* ==============================================================
                TAB 2: PERSONA & GROUNDING
                ============================================================== */}
            {activeTab === 'persona' && (
              <div className="space-y-5">
                <div>
                  <label htmlFor="businessName" className="block font-mono text-xs uppercase font-bold text-black mb-1.5">
                    Business Name
                  </label>
                  <input
                    id="businessName"
                    type="text"
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    placeholder="e.g. Fade & Co. Barbershop"
                    maxLength={80}
                    className="w-full border-2 border-black px-3 py-2 font-serif text-sm focus:outline-none bg-white text-black"
                  />
                  <p className="font-serif text-xs text-neutral-600 mt-1">
                    Shown at the top of the visitor chat and used by the AI when it introduces itself. Leave empty to use the name found in your knowledge base.
                  </p>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="font-mono text-xs uppercase font-bold text-black">
                      System Persona &amp; Guardrail Prompt
                    </label>
                    <span className="font-mono text-[10px] text-neutral-500 uppercase">
                      INJECTED INTO EVERY LLM TURN
                    </span>
                  </div>
                  <textarea
                    rows={8}
                    value={systemInstruction}
                    onChange={(e) => setSystemInstruction(e.target.value)}
                    className="w-full border-2 border-black p-3 font-mono text-xs leading-relaxed focus:outline-none bg-neutral-50 text-black"
                    placeholder="Define how the AI represents your business..."
                  />
                  <p className="font-serif text-xs text-neutral-600 mt-1">
                    Defines the assistant voice, brand tone, company policies, and refusal behavior for non-grounded questions.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="border border-black p-3.5 space-y-2">
                    <label className="font-mono text-xs uppercase font-bold text-black block">
                      RAG Context Injection (Top-K Chunks)
                    </label>
                    <select
                      value={ragTopK}
                      onChange={(e) => setRagTopK(parseInt(e.target.value))}
                      className="w-full border border-black bg-white px-2 py-1 font-mono text-xs uppercase focus:outline-none"
                    >
                      <option value="1">Top 1 Document Chunk</option>
                      <option value="2">Top 2 Document Chunks (Recommended)</option>
                      <option value="3">Top 3 Document Chunks</option>
                      <option value="5">Top 5 Document Chunks</option>
                    </select>
                    <p className="font-mono text-[10px] text-neutral-500">
                      Number of ChromaDB documents injected into LLM context window.
                    </p>
                  </div>

                  <div className="border border-black p-3.5 flex flex-col justify-between">
                    <div>
                      <span className="font-mono text-xs uppercase font-bold text-black block mb-1">
                        Strict Grounding Enforcement
                      </span>
                      <p className="font-serif text-xs text-neutral-600">
                        Instructs the model to refuse answering topics absent from the vector database.
                      </p>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="strictGrounding"
                        checked={strictGrounding}
                        onChange={(e) => setStrictGrounding(e.target.checked)}
                        className="accent-black w-4 h-4 cursor-pointer"
                      />
                      <label htmlFor="strictGrounding" className="font-mono text-xs uppercase font-semibold cursor-pointer">
                        {strictGrounding ? 'Enabled (Zero Hallucination)' : 'Disabled'}
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ==============================================================
                TAB 3: AUTOMATION & BOT PAUSE (ELQEN ZERO CONTRACT)
                ============================================================== */}
            {activeTab === 'automation' && (
              <div className="space-y-6">
                
                {/* Bot Pause Window Settings */}
                <div className="border-2 border-black p-4 bg-neutral-50 space-y-3">
                  <div className="flex items-center justify-between border-b border-black pb-2">
                    <span className="font-mono text-xs uppercase font-bold text-black flex items-center gap-2">
                      <Clock className="w-3.5 h-3.5" />
                      <span>Elqen Zero Bot Pause Window Contract</span>
                    </span>
                    <span className="font-mono text-xs font-bold text-black">
                      [{pauseMinutes} MINUTES]
                    </span>
                  </div>

                  <p className="font-serif text-xs text-neutral-700 leading-relaxed">
                    When a live support specialist transmits an outbound message, the autonomous AI bot is silenced for this window. Inbound visitor responses remain in the human queue without bot interruptions.
                  </p>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {[15, 30, 60, 120].map((mins) => (
                      <button
                        key={mins}
                        type="button"
                        onClick={() => setPauseMinutes(mins)}
                        className={`px-3 py-1 font-mono text-xs uppercase font-bold border transition-none cursor-pointer ${
                          pauseMinutes === mins 
                            ? 'border-black bg-black text-white' 
                            : 'border-neutral-400 bg-white text-black hover:border-black'
                        }`}
                      >
                        {mins} Minutes {mins === 30 && '(Standard)'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Handoff Trigger Keywords */}
                <div className="space-y-2">
                  <label className="block font-mono text-xs uppercase font-bold text-black">
                    Auto-Handoff Trigger Keywords (Comma Separated)
                  </label>
                  <textarea
                    rows={3}
                    value={handoffKeywordsStr}
                    onChange={(e) => setHandoffKeywordsStr(e.target.value)}
                    className="w-full border-2 border-black p-3 font-mono text-xs bg-white text-black focus:outline-none"
                    placeholder="human, agent, representative, speak to a human..."
                  />
                  <p className="font-mono text-[10px] text-neutral-500 uppercase">
                    Whole-word matches immediately transition the conversation to &quot;human_handover&quot;. Refunds and disputes are escalated by the AI&apos;s handoff tool instead.
                  </p>
                </div>

                {/* Calendar Tool Integration */}
                <div className="border border-black p-3.5 flex items-center justify-between">
                  <div>
                    <span className="font-mono text-xs uppercase font-bold text-black block mb-0.5">
                      Autonomous Calendar Tool (Function Calling)
                    </span>
                    <p className="font-serif text-xs text-neutral-600">
                      Allows the AI to autonomously parse appointment requests and execute commits to the SQLite booking ledger.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <input
                      type="checkbox"
                      id="enableCalendar"
                      checked={enableCalendar}
                      onChange={(e) => setEnableCalendar(e.target.checked)}
                      className="accent-black w-4 h-4 cursor-pointer"
                    />
                    <label htmlFor="enableCalendar" className="font-mono text-xs uppercase font-semibold cursor-pointer">
                      {enableCalendar ? 'Enabled' : 'Disabled'}
                    </label>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer Bar */}
          <div className="px-6 py-3.5 border-t-2 border-black bg-neutral-100 flex items-center justify-between shrink-0 font-mono text-xs">
            <div className="flex items-center gap-2">
              {saveSuccess && (
                <span className="text-black font-bold flex items-center gap-1.5 uppercase">
                  <Check className="w-4 h-4" />
                  <span>Settings Deployed Successfully!</span>
                </span>
              )}
              {!saveSuccess && (
                <span className="text-neutral-500 uppercase">
                  Changes take effect immediately on next turn
                </span>
              )}
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="border border-neutral-400 bg-white hover:border-black px-4 py-2 font-mono uppercase font-bold text-black transition-none cursor-pointer"
              >
                Close
              </button>
              <button
                type="submit"
                disabled={saving}
                className="border-2 border-black bg-black text-white hover:bg-white hover:text-black px-6 py-2 font-mono uppercase font-bold tracking-wider transition-none cursor-pointer disabled:opacity-50"
              >
                {saving ? 'Deploying...' : 'Save & Deploy Settings →'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
