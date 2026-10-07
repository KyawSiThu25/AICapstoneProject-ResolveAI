import React, { useState } from 'react';
import { CheckCircle2, Sparkles, ChevronRight, Activity } from 'lucide-react';


interface Scenario {
  id: string;
  name: string;
  userPrompt: string;
  pipelineBadge: string;
  badgeColor: string;
  steps: {
    title: string;
    detail: string;
    tech: string;
  }[];
  sampleResponse: string;
}

const SCENARIOS: Scenario[] = [
  {
    id: 'rag',
    name: '1. RAG Grounding',
    userPrompt: '"What are the differences between your Starter and Pro plans?"',
    pipelineBadge: 'VECTOR SEARCH (CHROMADB)',
    badgeColor: 'text-cyan-400 border-cyan-800/60 bg-cyan-950/40',
    steps: [
      { title: 'Vector Ingestion', detail: 'Cosine similarity query against company documentation', tech: 'ChromaDB Local Disk' },
      { title: 'Context Augmentation', detail: 'Pricing tiers injected directly into LLM system prompt', tech: 'Dynamic Context Window' },
      { title: 'Grounded Answer', detail: 'Zero hallucinations, verified facts cited back to customer', tech: 'Gemini 2.5 Flash' }
    ],
    sampleResponse: 'The Starter plan ($29/mo) includes 1,000 AI sessions & 1 human seat, while Professional ($99/mo) provides 10,000 AI sessions, 5 agent seats, and automated calendar booking.'
  },
  {
    id: 'calendar',
    name: '2. Function Calling',
    userPrompt: '"Can I schedule a product consultation for tomorrow at 14:30?"',
    pipelineBadge: 'TOOL EXECUTION (CALENDAR API)',
    badgeColor: 'text-indigo-400 border-indigo-800/60 bg-indigo-950/40',
    steps: [
      { title: 'Intent & Parameter Parse', detail: 'Extracted: date="2026-10-08", time="14:30", type="Consultation"', tech: 'Function Calling Schema' },
      { title: 'Slot Verification', detail: 'Executed check_calendar_availability to verify slot is open', tech: 'SQLModel Query' },
      { title: 'Appointment Confirmed', detail: 'Created CalendarBooking record in SQLite & returned confirmation ID', tech: 'Transactional Commit' }
    ],
    sampleResponse: '🎉 Your Product Consultation is booked for tomorrow, 2026-10-08 at 14:30 (Booking #4). Added to company calendar.'
  },
  {
    id: 'handoff',
    name: '3. Human Takeover',
    userPrompt: '"I need to talk to a human specialist right now."',
    pipelineBadge: 'AGENT HANDOFF (WEBSOCKET)',
    badgeColor: 'text-amber-400 border-amber-800/60 bg-amber-950/40',
    steps: [
      { title: 'Escalation Detected', detail: 'Trigger phrase matched handoff intent guardrails', tech: 'Handoff Detector' },
      { title: 'AI Paused', detail: 'Conversation status flipped to "human_handover" in database', tech: 'State Machine' },
      { title: 'Live Agent Alert', detail: 'Pushed session alert instantly to Business Console on Port 5174', tech: 'WebSocket Broadcast' }
    ],
    sampleResponse: 'I have routed your chat directly to our support desk. A human specialist on Port 5174 is taking over now.'
  }
];

export const LandingPage: React.FC = () => {
  const [activeScenario, setActiveScenario] = useState<Scenario>(SCENARIOS[0]);

  return (
    <div className="bg-[#090D16] text-[#F8FAFC]">
      {/* Hero Section */}
      <section className="relative pt-20 pb-16 px-6 max-w-6xl mx-auto flex flex-col items-center text-center">
        {/* Subtle status eyebrow */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-slate-300 text-xs font-mono mb-8">
          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
          <span>AUTONOMOUS ENGINE • LOCAL VECTOR RAG • ZERO CLOUD LOCK-IN</span>
        </div>

        <h1 className="text-4xl sm:text-6xl font-heading font-extrabold tracking-tight text-white max-w-4xl leading-[1.12]">
          Support without hallucination. <br className="hidden sm:block" />
          <span className="bg-gradient-to-r from-cyan-400 via-sky-300 to-indigo-400 bg-clip-text text-transparent">
            Escalation without friction.
          </span>
        </h1>

        <p className="mt-6 text-base sm:text-lg text-slate-400 max-w-2xl font-sans leading-relaxed">
          Apex Solutions grounds visitor inquiries in local ChromaDB vectors, executes calendar bookings via tool calling, and shifts to human agent cockpits in sub-second latency.
        </p>

        {/* Live Simulator Widget (The Signature Element) */}
        <div id="simulator" className="mt-14 w-full max-w-4xl bg-slate-900/90 border border-slate-800/90 rounded-2xl p-6 sm:p-8 text-left shadow-2xl backdrop-blur-xl glow-cyan-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 border-b border-slate-800/80 gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-cyan-400" />
                <h3 className="font-heading font-bold text-white text-base tracking-tight">Interactive Pipeline Simulator</h3>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">Explore how the AI backend resolves distinct customer intents</p>
            </div>

            {/* Scenario Switchers */}
            <div className="flex p-1 bg-slate-950 rounded-xl border border-slate-800 text-xs font-medium">
              {SCENARIOS.map((sc) => (
                <button
                  key={sc.id}
                  onClick={() => setActiveScenario(sc)}
                  className={`px-3 py-1.5 rounded-lg transition-all ${
                    activeScenario.id === sc.id
                      ? 'bg-slate-800 text-white font-semibold shadow-sm border border-slate-700/60'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {sc.name}
                </button>
              ))}
            </div>
          </div>

          {/* Active Flow Visualization */}
          <div className="mt-6 space-y-6">
            {/* Input query card */}
            <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="text-[11px] font-mono text-slate-500 uppercase">Customer Query:</span>
                <span className="text-sm font-medium text-slate-200">{activeScenario.userPrompt}</span>
              </div>
              <span className={`text-[10px] font-mono px-2.5 py-1 rounded-md border font-semibold ${activeScenario.badgeColor}`}>
                {activeScenario.pipelineBadge}
              </span>
            </div>

            {/* The 3 Pipeline Steps */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
              {activeScenario.steps.map((step, idx) => (
                <div key={idx} className="bg-slate-850/40 bg-slate-900 border border-slate-800/90 rounded-xl p-4 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] font-mono text-cyan-400 font-semibold">STAGE 0{idx + 1}</span>
                      <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-mono">{step.tech}</span>
                    </div>
                    <h4 className="text-sm font-semibold text-white mb-1">{step.title}</h4>
                    <p className="text-xs text-slate-400 leading-relaxed">{step.detail}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Verified Output Card */}
            <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 border border-cyan-900/40 rounded-xl p-4.5 flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-cyan-950/80 border border-cyan-800/60 flex items-center justify-center text-cyan-300 shrink-0 mt-0.5">
                <Sparkles className="w-4 h-4" />
              </div>
              <div className="flex-1">
                <span className="text-[10px] font-mono text-cyan-400 font-semibold uppercase tracking-wider">
                  Automated Output Delivered:
                </span>
                <p className="text-xs sm:text-sm text-slate-200 mt-1 font-mono leading-relaxed">
                  {activeScenario.sampleResponse}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Live CTA Bar pointing to the Chat Widget */}
        <div className="mt-8 flex items-center gap-3 px-5 py-3 rounded-full bg-slate-900 border border-cyan-800/40 text-xs text-slate-300">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>Test the live agent now: Click the <strong>Chat Widget</strong> in the bottom right corner</span>
          <ChevronRight className="w-4 h-4 text-cyan-400" />
        </div>
      </section>

      {/* Pricing Section (Directly Matches ChromaDB Knowledge Base) */}
      <section id="pricing" className="py-20 px-6 max-w-6xl mx-auto border-t border-slate-800/60">
        <div className="text-center max-w-2xl mx-auto mb-14">
          <span className="text-xs font-mono text-cyan-400 uppercase tracking-wider font-semibold">
            COMPANY KNOWLEDGE BASE
          </span>
          <h2 className="text-3xl font-heading font-bold text-white mt-2">
            Transparent Pricing Indexed in ChromaDB
          </h2>
          <p className="text-xs sm:text-sm text-slate-400 mt-2">
            Every tier and policy below is ingested into the local vector database for ground-truth answering.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Starter */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-7 flex flex-col justify-between hover:border-slate-700 transition-all">
            <div>
              <div className="flex items-center justify-between">
                <h3 className="font-heading font-bold text-lg text-white">Starter</h3>
                <span className="text-[10px] font-mono bg-slate-800 text-slate-300 px-2 py-0.5 rounded">doc_pricing:1</span>
              </div>
              <p className="text-xs text-slate-400 mt-1.5">For growing products &amp; pilots</p>
              
              <div className="mt-5 flex items-baseline gap-1">
                <span className="text-4xl font-extrabold text-white tracking-tight">$29</span>
                <span className="text-xs text-slate-400 font-medium">/month</span>
              </div>

              <ul className="mt-7 space-y-3 text-xs text-slate-300">
                <li className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span><strong>1,000</strong> AI Resolution Sessions</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span><strong>1</strong> Human Agent Seat (Port 5174)</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span>Standard Email Support</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span>14-Day Money-Back Guarantee</span>
                </li>
              </ul>
            </div>
          </div>

          {/* Professional */}
          <div className="bg-slate-900/90 border-2 border-cyan-500 rounded-2xl p-7 flex flex-col justify-between relative shadow-xl shadow-cyan-500/10">
            <span className="absolute -top-3 right-6 bg-cyan-500 text-slate-950 text-[10px] font-extrabold uppercase tracking-wider px-3 py-0.5 rounded-full">
              Recommended
            </span>
            <div>
              <div className="flex items-center justify-between">
                <h3 className="font-heading font-bold text-lg text-white">Professional</h3>
                <span className="text-[10px] font-mono bg-cyan-950 text-cyan-300 border border-cyan-800/60 px-2 py-0.5 rounded">doc_pricing:2</span>
              </div>
              <p className="text-xs text-slate-400 mt-1.5">For active support operations</p>
              
              <div className="mt-5 flex items-baseline gap-1">
                <span className="text-4xl font-extrabold text-white tracking-tight">$99</span>
                <span className="text-xs text-slate-400 font-medium">/month</span>
              </div>

              <ul className="mt-7 space-y-3 text-xs text-slate-200">
                <li className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span><strong>10,000</strong> AI Resolution Sessions</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span><strong>5</strong> Human Agent Seats</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span>Calendar Function Calling Tool</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span>24/7 Priority Support Desk</span>
                </li>
              </ul>
            </div>
          </div>

          {/* Enterprise */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-7 flex flex-col justify-between hover:border-slate-700 transition-all">
            <div>
              <div className="flex items-center justify-between">
                <h3 className="font-heading font-bold text-lg text-white">Enterprise</h3>
                <span className="text-[10px] font-mono bg-slate-800 text-slate-300 px-2 py-0.5 rounded">doc_pricing:3</span>
              </div>
              <p className="text-xs text-slate-400 mt-1.5">For dedicated high-volume infrastructure</p>
              
              <div className="mt-5 flex items-baseline gap-1">
                <span className="text-4xl font-extrabold text-white tracking-tight">Custom</span>
              </div>

              <ul className="mt-7 space-y-3 text-xs text-slate-300">
                <li className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span><strong>Unlimited</strong> AI Sessions</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span>Dedicated Solutions Architect</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span>Custom Vector Store Embedding</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span>99.99% Guaranteed SLA</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
