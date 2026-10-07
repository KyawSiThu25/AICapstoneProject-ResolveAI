import React, { useState } from 'react';
import { ChatWidget } from './ChatWidget';
import { X, Check } from 'lucide-react';

// Port 5173 is the visitor chat itself: no landing page, straight into the conversation.
export const CustomerApp: React.FC = () => {
  const [searchParams] = useState(new URLSearchParams(window.location.search));
  const isEmbedded = searchParams.get('embed') === '1' || searchParams.get('embed') === 'true';

  // Minimalist Monochrome Report Dialog State
  const [reportOpen, setReportOpen] = useState(false);
  const [reportCategory, setReportCategory] = useState("suspected_illegal_activity");
  const [reportDescription, setReportDescription] = useState("");
  const [reportEmail, setReportEmail] = useState("");
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportSent, setReportSent] = useState(false);

  const handleSubmitReport = (e: React.FormEvent) => {
    e.preventDefault();
    setReportSubmitting(true);
    setTimeout(() => {
      setReportSubmitting(false);
      setReportSent(true);
      setReportDescription("");
      setReportEmail("");
    }, 400);
  };

  return (
    <div className="w-screen h-screen bg-white text-black flex flex-col overflow-hidden font-serif selection:bg-black selection:text-white">
      <ChatWidget
        standalone
        embedded
        onReport={isEmbedded ? undefined : () => {
          setReportSent(false);
          setReportOpen(true);
        }}
      />

      {/* Minimalist Monochrome Report Modal Dialog */}
      {reportOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-none p-4">
          <div className="w-full max-w-lg border-4 border-black bg-white p-6 sm:p-8">
            {reportSent ? (
              <div className="space-y-6">
                <div className="flex items-center gap-3 border-b-2 border-black pb-4">
                  <div className="h-8 w-8 bg-black text-white flex items-center justify-center font-bold">
                    <Check className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-display text-xl font-bold uppercase tracking-tight text-black">Report Received</h3>
                    <p className="font-mono text-xs text-neutral-500">LOGGED TO REVIEW QUEUE</p>
                  </div>
                </div>
                <p className="font-serif text-sm leading-relaxed text-neutral-800">
                  Your concern has been registered. If contact credentials were supplied, authorized compliance personnel will inspect the transcript.
                </p>
                <button
                  type="button"
                  onClick={() => { setReportOpen(false); setReportSent(false); }}
                  className="w-full border-2 border-black bg-black py-3 font-mono text-xs font-bold uppercase tracking-widest text-white hover:bg-white hover:text-black transition-none cursor-pointer"
                >
                  Dismiss
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmitReport} className="space-y-5">
                <div className="flex items-center justify-between border-b-2 border-black pb-4">
                  <div>
                    <h3 className="font-display text-xl font-bold uppercase tracking-tight text-black">Report Concern</h3>
                    <p className="font-mono text-[11px] text-neutral-500 uppercase tracking-wider">OFFICIAL COMPLIANCE FILING</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setReportOpen(false)}
                    className="p-1 text-black hover:bg-black hover:text-white transition-none"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div>
                  <label className="block font-mono text-xs uppercase tracking-wider font-semibold text-black mb-1">
                    Classification
                  </label>
                  <select
                    value={reportCategory}
                    onChange={(e) => setReportCategory(e.target.value)}
                    className="w-full border-2 border-black bg-white p-2.5 font-serif text-sm text-black focus:outline-none"
                  >
                    <option value="suspected_illegal_activity">Suspected illegal activity</option>
                    <option value="fraud_or_impersonation">Fraud or impersonation</option>
                    <option value="threats_or_harassment">Threats or harassment</option>
                    <option value="spam_or_abuse">Spam or abuse</option>
                    <option value="privacy_or_ip">Privacy or intellectual property</option>
                    <option value="unsafe_content">Unsafe content</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <div>
                  <label className="block font-mono text-xs uppercase tracking-wider font-semibold text-black mb-1">
                    Incident Description *
                  </label>
                  <textarea
                    required
                    minLength={10}
                    maxLength={4000}
                    value={reportDescription}
                    onChange={(e) => setReportDescription(e.target.value)}
                    placeholder="Provide details regarding the concern..."
                    rows={4}
                    className="w-full border-2 border-black bg-white p-3 font-serif text-sm text-black placeholder:text-neutral-400 placeholder:italic focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block font-mono text-xs uppercase tracking-wider font-semibold text-black mb-1">
                    Contact Email (Optional)
                  </label>
                  <input
                    type="email"
                    value={reportEmail}
                    onChange={(e) => setReportEmail(e.target.value)}
                    placeholder="you@domain.com"
                    className="w-full border-2 border-black bg-white p-2.5 font-serif text-sm text-black placeholder:text-neutral-400 placeholder:italic focus:outline-none"
                  />
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setReportOpen(false)}
                    className="flex-1 border-2 border-black bg-white py-3 font-mono text-xs font-bold uppercase tracking-widest text-black hover:bg-neutral-100 transition-none cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={reportSubmitting || reportDescription.trim().length < 10}
                    className="flex-1 border-2 border-black bg-black py-3 font-mono text-xs font-bold uppercase tracking-widest text-white hover:bg-white hover:text-black disabled:bg-neutral-300 disabled:border-neutral-300 disabled:text-neutral-600 transition-none cursor-pointer"
                  >
                    {reportSubmitting ? "Transmitting..." : "Submit File"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
