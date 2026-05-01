-- Migration: Add campaigns and campaign_contacts tables
-- Run this in Supabase SQL editor

create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid references agents(id) on delete set null,
  name text not null,
  status text not null default 'draft',  -- draft|running|paused|completed|cancelled
  schedule_start timestamptz,
  schedule_timezone text not null default 'America/New_York',
  calling_hours_start time not null default '09:00',
  calling_hours_end time not null default '17:00',
  calling_days text[] not null default '{mon,tue,wed,thu,fri}',
  max_retries int not null default 2,
  retry_delay_hours int not null default 4,
  voicemail_drop_url text not null default '',
  dnc_numbers text[] not null default '{}',
  total_contacts int not null default 0,
  called int not null default 0,
  answered int not null default 0,
  voicemail int not null default 0,
  failed int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists campaign_contacts (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references campaigns(id) on delete cascade,
  phone text not null,
  name text not null default '',
  custom_fields jsonb not null default '{}',
  status text not null default 'pending',  -- pending|calling|answered|voicemail|failed|dnc|skipped|completed
  attempts int not null default 0,
  last_called_at timestamptz,
  call_sid text not null default '',
  next_retry_at timestamptz,
  created_at timestamptz not null default now()
);

-- Indexes for fast queries
create index if not exists campaign_contacts_campaign_id_idx on campaign_contacts(campaign_id);
create index if not exists campaign_contacts_status_idx on campaign_contacts(campaign_id, status);
create index if not exists campaign_contacts_retry_idx on campaign_contacts(next_retry_at) where status = 'failed';

-- Add campaigns tables to schema.sql too if doing fresh install
