-- ================================================================================
-- IqwanEngine PU Prime Ecosystem: Supabase Schema & Security Setup
-- Table: clients
-- ================================================================================

-- 1. Enable UUID generator extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Create the 'clients' table according to verified schema specifications:
--    - id: UUID (Primary Key, auto-generated)
--    - name: string (Full Name from form)
--    - email: string (Email Address from form)
--    - phone: string (Phone / WhatsApp from form)
--    - state: string (State / Negeri from form)
--    - registration_date: timestamptz (auto-populated by now())
--    - status: default 'New'
--    - action_status: default 'New'
--    - remark: null (strictly empty/blank initially)
--    - updated_at: null (strictly empty until modified)
--    - full_name: text (synced with name)
CREATE TABLE IF NOT EXISTS public.clients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  state TEXT NOT NULL,
  registration_date TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  status TEXT NOT NULL DEFAULT 'New',
  action_status TEXT NOT NULL DEFAULT 'New',
  remark TEXT DEFAULT NULL,
  updated_at TIMESTAMPTZ DEFAULT NULL
);

-- Ensure action_status exists if table was created previously without it
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'clients' 
    AND column_name = 'action_status'
  ) THEN
    ALTER TABLE public.clients ADD COLUMN action_status TEXT DEFAULT 'New';
  END IF;
END $$;

-- Ensure full_name exists for backwards compatibility
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'clients' 
    AND column_name = 'full_name'
  ) THEN
    ALTER TABLE public.clients ADD COLUMN full_name TEXT;
    UPDATE public.clients SET full_name = name WHERE full_name IS NULL;
  END IF;
END $$;

-- 3. Create high-performance indexes
CREATE INDEX IF NOT EXISTS idx_clients_status ON public.clients(status);
CREATE INDEX IF NOT EXISTS idx_clients_action_status ON public.clients(action_status);
CREATE INDEX IF NOT EXISTS idx_clients_registration_date ON public.clients(registration_date DESC);
CREATE INDEX IF NOT EXISTS idx_clients_email ON public.clients(email);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

-- 5. Row Level Security Policies
-- Policy 1: Allow public visitors to submit registrations
DROP POLICY IF EXISTS "Allow public registration insert" ON public.clients;
CREATE POLICY "Allow public registration insert"
ON public.clients
FOR INSERT
TO anon, authenticated
WITH CHECK (true);

-- Policy 2: Allow reading records for Admin and BDM portals
DROP POLICY IF EXISTS "Allow portal select clients" ON public.clients;
CREATE POLICY "Allow portal select clients"
ON public.clients
FOR SELECT
TO anon, authenticated
USING (true);

-- Policy 3: Allow updating records (Admin remark transitions, BDM completion)
DROP POLICY IF EXISTS "Allow portal update clients" ON public.clients;
CREATE POLICY "Allow portal update clients"
ON public.clients
FOR UPDATE
TO anon, authenticated
USING (true)
WITH CHECK (true);

-- Policy 4: Allow deleting records (Admin delete action)
DROP POLICY IF EXISTS "Allow portal delete clients" ON public.clients;
CREATE POLICY "Allow portal delete clients"
ON public.clients
FOR DELETE
TO anon, authenticated
USING (true);

-- 6. Enable Realtime Replication for instant multi-user syncing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
    AND schemaname = 'public' 
    AND tablename = 'clients'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.clients;
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END $$;

-- 7. CRITICAL: Reload PostgREST Schema Cache
-- Execute this notification whenever altering table schemas to clear the
-- "Could not find the 'action_status' column of 'clients' in the schema cache" error:
NOTIFY pgrst, 'reload schema';

-- 8. Stored Procedure for PostgREST schema cache reload via RPC
CREATE OR REPLACE FUNCTION public.reload_schema()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  NOTIFY pgrst, 'reload schema';
END;
$$;

GRANT EXECUTE ON FUNCTION public.reload_schema() TO anon, authenticated;

-- ================================================================================
-- Table: system_settings (Enterprise Centralized Configuration Repository)
-- ================================================================================

CREATE TABLE IF NOT EXISTS public.system_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  setting_key TEXT UNIQUE NOT NULL,
  setting_value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Index on setting_key for sub-millisecond lookups
CREATE INDEX IF NOT EXISTS idx_system_settings_key ON public.system_settings(setting_key);

-- Enable Row Level Security (RLS)
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

-- Policy 1: Allow SELECT for all authenticated and portal roles
DROP POLICY IF EXISTS "Allow select system_settings" ON public.system_settings;
CREATE POLICY "Allow select system_settings"
ON public.system_settings
FOR SELECT
TO anon, authenticated
USING (true);

-- Policy 2: Allow modify system_settings (Superadmin / Authorized portal operations)
DROP POLICY IF EXISTS "Allow modify system_settings" ON public.system_settings;
CREATE POLICY "Allow modify system_settings"
ON public.system_settings
FOR ALL
TO anon, authenticated
USING (true)
WITH CHECK (true);

-- Default Initial Configuration Inserts
INSERT INTO public.system_settings (setting_key, setting_value, updated_at)
VALUES 
  ('admin_whatsapp', '"+60102263677"'::jsonb, now()),
  ('remark_options', '[
    {"id": "1", "label": "$14USD / 1Lot", "targetAction": "Submit to BDM"},
    {"id": "2", "label": "No Rebate", "targetAction": "Do Nothing"},
    {"id": "3", "label": "Not Register Yet", "targetAction": "Do Nothing"},
    {"id": "4", "label": "Others", "targetAction": "Do Nothing"}
  ]'::jsonb, now())
ON CONFLICT (setting_key) DO NOTHING;

-- Enable Realtime Replication for system_settings
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
    AND schemaname = 'public' 
    AND tablename = 'system_settings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.system_settings;
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END $$;

NOTIFY pgrst, 'reload schema';
