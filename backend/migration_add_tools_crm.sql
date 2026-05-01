-- Migration: Add HTTP Tools and CRM Integration columns to existing agents table
-- Run this in Supabase SQL Editor if you have an existing agents table

alter table agents
  add column if not exists agent_tools jsonb not null default '[]',
  add column if not exists crm_integration jsonb not null default '{"provider":"none","api_key":"","portal_id":"","pipeline_id":"","base_url":"","field_mapping":{},"trigger":"hot_warm","enabled":false}';
