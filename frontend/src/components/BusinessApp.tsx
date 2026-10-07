import React, { useState } from 'react';
import { BusinessNavbar } from './BusinessNavbar';
import { AgentInbox } from './AgentInbox';
import { KnowledgeBaseModal } from './KnowledgeBaseModal';
import { CalendarModal } from './CalendarModal';
import { AiSettingsModal } from './AiSettingsModal';
import { ResetDataModal } from './ResetDataModal';

export const BusinessApp: React.FC = () => {
  const [isKnowledgeOpen, setIsKnowledgeOpen] = useState(false);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [isAiSettingsOpen, setIsAiSettingsOpen] = useState(false);
  const [isResetOpen, setIsResetOpen] = useState(false);
  const [stats, setStats] = useState<{ total: number; handoff: number; ai: number; resolved: number }>({
    total: 0,
    handoff: 0,
    ai: 0,
    resolved: 0
  });

  return (
    <div className="h-screen w-screen bg-white text-black flex flex-col font-serif selection:bg-black selection:text-white overflow-hidden">
      <BusinessNavbar
        onOpenKnowledge={() => setIsKnowledgeOpen(true)}
        onOpenCalendar={() => setIsCalendarOpen(true)}
        onOpenAiSettings={() => setIsAiSettingsOpen(true)}
        onOpenReset={() => setIsResetOpen(true)}
        stats={stats}
      />
      <main className="flex-1 flex flex-col min-h-0 bg-white overflow-hidden">
        <AgentInbox
          onOpenKnowledge={() => setIsKnowledgeOpen(true)}
          onOpenCalendar={() => setIsCalendarOpen(true)}
          onOpenAiSettings={() => setIsAiSettingsOpen(true)}
          onStatsUpdate={setStats}
        />
      </main>

      <KnowledgeBaseModal isOpen={isKnowledgeOpen} onClose={() => setIsKnowledgeOpen(false)} />
      <CalendarModal isOpen={isCalendarOpen} onClose={() => setIsCalendarOpen(false)} />
      <AiSettingsModal isOpen={isAiSettingsOpen} onClose={() => setIsAiSettingsOpen(false)} />
      <ResetDataModal isOpen={isResetOpen} onClose={() => setIsResetOpen(false)} />
    </div>
  );
};
