-- Run this in your Supabase SQL editor to set up the database schema

-- Agents table
create table if not exists agents (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  persona_name text not null default 'Alex',
  persona_role text not null default 'Sales Representative',
  persona_company text not null default '',
  language text not null default 'en',
  voice_provider text not null default 'elevenlabs',
  voice_id text not null default '',
  stt_provider text not null default 'deepgram',
  llm_provider text not null default 'openai',
  llm_model text not null default 'gpt-4o',
  llm_api_key_encrypted text not null default '',
  tts_api_key_encrypted text not null default '',
  instructions text not null default '',
  goal text not null default 'collect_lead',
  max_call_duration_seconds integer not null default 300,
  fallback_message text not null default 'I''m sorry, I''m having trouble. Let me connect you with someone who can help.',
  call_flow jsonb not null default '{}',
  lead_fields jsonb not null default '[]',
  lead_scoring_rules text not null default '',
  webhook_url text not null default '',
  webhook_secret text not null default '',
  phone_number text not null default '',
  twilio_account_sid_encrypted text not null default '',
  twilio_auth_token_encrypted text not null default '',
  knowledge_base text not null default '',
  agent_tools jsonb not null default '[]',
  crm_integration jsonb not null default '{"provider":"none","api_key":"","portal_id":"","pipeline_id":"","base_url":"","field_mapping":{},"trigger":"hot_warm","enabled":false}',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agents_phone_number_idx on agents(phone_number) where enabled = true;

-- Calls table
create table if not exists calls (
  id uuid primary key default gen_random_uuid(),
  call_sid text not null unique,
  agent_id uuid references agents(id) on delete set null,
  phone_number text not null default '',
  duration_seconds integer not null default 0,
  transcript jsonb not null default '[]',
  lead_score text not null default 'cold',  -- hot | warm | cold
  outcome text not null default 'unknown',  -- interested | not_interested | booked | voicemail | unknown
  summary text not null default '',
  extracted_fields jsonb not null default '{}',
  status text not null default 'completed',  -- completed | converted | rejected
  recording_url text default null,
  created_at timestamptz not null default now()
);

create index if not exists calls_agent_id_idx on calls(agent_id);
create index if not exists calls_created_at_idx on calls(created_at desc);
create index if not exists calls_lead_score_idx on calls(lead_score);

-- Auto-update updated_at for agents
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists agents_updated_at on agents;
create trigger agents_updated_at
  before update on agents
  for each row execute function update_updated_at();


-- ──────────────────────────────────────────────────────────────────
-- Knowledge Base (requires pgvector extension)
-- Enable in Supabase: Extensions → search "vector" → enable
-- ──────────────────────────────────────────────────────────────────
create extension if not exists vector;

-- Uploaded document metadata
create table if not exists knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid references agents(id) on delete cascade,  -- NULL = app-level (Copilot KB)
  name text not null,
  file_type text not null default 'text',  -- pdf | text
  size_bytes integer not null default 0,
  chunk_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists knowledge_documents_agent_id_idx on knowledge_documents(agent_id);

-- Chunked + embedded text
create table if not exists knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references knowledge_documents(id) on delete cascade,
  agent_id uuid references agents(id) on delete cascade,  -- denormalized for fast lookup
  content text not null,
  embedding vector(1536),  -- OpenAI text-embedding-3-small
  created_at timestamptz not null default now()
);

create index if not exists knowledge_chunks_agent_id_idx on knowledge_chunks(agent_id);
create index if not exists knowledge_chunks_embedding_idx
  on knowledge_chunks using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- RPC used by Python backend for similarity search
create or replace function search_knowledge_chunks(
  query_embedding vector(1536),
  match_agent_id uuid,
  match_limit int default 5
)
returns table(id uuid, content text, similarity float8)
language plpgsql
as $$
begin
  return query
  select
    kc.id,
    kc.content,
    1 - (kc.embedding <=> query_embedding) as similarity
  from knowledge_chunks kc
  where
    (match_agent_id is null and kc.agent_id is null)
    or (match_agent_id is not null and kc.agent_id = match_agent_id)
  order by kc.embedding <=> query_embedding
  limit match_limit;
end;
$$;
