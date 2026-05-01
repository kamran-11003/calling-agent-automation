export interface CallFlowStage {
  greeting: string;
  qualification: string;
  objection_handling: string;
  goal_action: string;
  closing: string;
  fallback: string;
}

export interface LeadField {
  name: string;
  description: string;
}

export interface AgentConfig {
  id?: string;
  name: string;
  persona_name: string;
  persona_role: string;
  persona_company: string;
  language: string;
  voice_provider: "elevenlabs" | "cartesia" | "openai" | "google";
  voice_id: string;
  stt_provider: "deepgram" | "whisper";
  llm_provider: "openai" | "anthropic" | "google";
  llm_model: string;
  llm_api_key_encrypted: string;
  tts_api_key_encrypted: string;
  instructions: string;
  goal: "collect_lead" | "book_appointment" | "qualify" | "survey" | "customer_support" | "ivr_routing" | "reminder" | "custom";
  max_call_duration_seconds: number;
  fallback_message: string;
  call_flow: CallFlowStage;
  lead_fields: LeadField[];
  lead_scoring_rules: string;
  webhook_url: string;
  webhook_secret: string;
  phone_number: string;
  twilio_account_sid_encrypted: string;
  twilio_auth_token_encrypted: string;
  knowledge_base: string;
  enabled: boolean;
}

export const DEFAULT_AGENT: AgentConfig = {
  name: "",
  persona_name: "Alex",
  persona_role: "Sales Representative",
  persona_company: "",
  language: "en",
  voice_provider: "elevenlabs",
  voice_id: "",
  stt_provider: "deepgram",
  llm_provider: "openai",
  llm_model: "gpt-4o",
  llm_api_key_encrypted: "",
  tts_api_key_encrypted: "",
  instructions: "",
  goal: "collect_lead",
  max_call_duration_seconds: 300,
  fallback_message: "I'm sorry, I'm having trouble understanding. Let me connect you with someone who can help.",
  call_flow: {
    greeting: "",
    qualification: "",
    objection_handling: "",
    goal_action: "",
    closing: "",
    fallback: "",
  },
  lead_fields: [
    { name: "name", description: "Full name of the caller" },
    { name: "email", description: "Email address" },
    { name: "phone", description: "Phone number if mentioned" },
    { name: "interest", description: "What they are interested in" },
    { name: "budget", description: "Budget or price range if mentioned" },
  ],
  lead_scoring_rules: "",
  webhook_url: "",
  webhook_secret: "",
  phone_number: "",
  twilio_account_sid_encrypted: "",
  twilio_auth_token_encrypted: "",
  knowledge_base: "",
  enabled: true,
};

export interface CallRecord {
  id: string;
  call_sid: string;
  agent_id: string;
  phone_number: string;
  duration_seconds: number;
  transcript: Array<{ role: string; text: string; timestamp: number }>;
  lead_score: "hot" | "warm" | "cold";
  outcome: string;
  summary: string;
  extracted_fields: Record<string, string>;
  status: string;
  recording_url?: string;
  created_at: string;
}

export interface CopilotMessage {
  role: "user" | "assistant";
  content: string;
}

export interface SimulationTurn {
  role: "agent" | "user";
  text: string;
}
