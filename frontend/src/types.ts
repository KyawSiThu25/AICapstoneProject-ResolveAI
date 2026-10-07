export interface Message {
  id?: number;
  sender: 'visitor' | 'ai' | 'agent' | 'system';
  content: string;
  created_at?: string;
  metadata?: {
    sources?: string[];
    tool_called?: string | null;
    tool_result?: any;
    handoff_triggered?: boolean;
    mode?: string;
  };
}

export interface ConversationSummary {
  id: string;
  visitor_name: string;
  visitor_email?: string;
  status: 'ai_active' | 'human_handover' | 'resolved';
  bot_paused_until?: string | null;
  created_at: string;
  updated_at: string;
  last_message?: string;
  last_sender?: string;
  last_message_time?: string;
}

export interface KnowledgeDocument {
  id: string;
  content: string;
  metadata?: {
    title?: string;
    category?: string;
    chunk_count?: number;
  };
}

export type BookingStatus = 'confirmed' | 'completed' | 'no_show' | 'cancelled';

export interface CalendarBooking {
  id: number;
  conversation_id: string;
  visitor_name: string;
  email_or_phone?: string | null;
  service_type: string;
  service_id?: number | null;
  staff_id?: number | null;
  staff_name?: string | null;
  booking_date: string;
  booking_time: string;
  duration_minutes: number;
  status: BookingStatus;
  created_at: string;
}

export interface ServiceItem {
  id: number;
  name: string;
  duration_minutes: number;
  price?: number | null;
  is_active: boolean;
}

export interface StaffItem {
  id: number;
  name: string;
  role?: string | null;
  service_ids: number[]; // empty = performs every service
  working_days: number[]; // Monday = 0 ... Sunday = 6
  is_active: boolean;
}

export interface ScheduleSettings {
  open_time: string;
  close_time: string;
  working_days: number[];
  slot_step_minutes: number;
  min_notice_minutes: number;
  max_days_ahead: number;
  default_duration_minutes: number;
}

export interface AiSettings {
  provider: string;
  business_name: string;
  model: string;
  temperature: number;
  max_output_tokens: number;
  system_instruction: string;
  bot_pause_duration_minutes: number;
  handoff_keywords: string[];
  rag_top_k: number;
  strict_grounding: boolean;
  enable_calendar_tool: boolean;
  api_key_masked: string;
  has_api_key: boolean;
}

