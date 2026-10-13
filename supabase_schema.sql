-- ================================================================================
-- IqwanEngine VT Market Ecosystem: Supabase Schema & Security Setup
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
-- Policy 1: Allow public visitors and authenticated admins to submit/seed registrations
DROP POLICY IF EXISTS "Allow public registration insert" ON public.clients;
DROP POLICY IF EXISTS "Allow portal insert clients" ON public.clients;
DROP POLICY IF EXISTS "Allow authenticated insert" ON public.clients;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public.clients;
DROP POLICY IF EXISTS "Enable insert for anon only" ON public.clients;
DROP POLICY IF EXISTS "Enable insert for all users" ON public.clients;
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

-- Policy 2: Allow INSERT for public / portal setup and system sync
DROP POLICY IF EXISTS "Allow modify system_settings" ON public.system_settings;
DROP POLICY IF EXISTS "Allow insert system_settings" ON public.system_settings;
CREATE POLICY "Allow insert system_settings"
ON public.system_settings
FOR INSERT
TO anon, authenticated
WITH CHECK (true);

-- Policy 3: Allow UPDATE for remark options and admin whatsapp configuration
DROP POLICY IF EXISTS "Allow update system_settings" ON public.system_settings;
CREATE POLICY "Allow update system_settings"
ON public.system_settings
FOR UPDATE
TO anon, authenticated
USING (true)
WITH CHECK (true);

-- Policy 4: Allow DELETE for system_settings cleanup
DROP POLICY IF EXISTS "Allow delete system_settings" ON public.system_settings;
CREATE POLICY "Allow delete system_settings"
ON public.system_settings
FOR DELETE
TO anon, authenticated
USING (true);

-- Default Initial Configuration Inserts (7 System Presets)
INSERT INTO public.system_settings (setting_key, setting_value, updated_at)
VALUES
  ('admin_whatsapp', '"+60102263677"'::jsonb, now()),
  ('remark_options', '[
    {"id": "1", "label": "STP VIP 16$", "targetAction": "Submit to BDM"},
    {"id": "2", "label": "STP IB 14$", "targetAction": "Submit to BDM"},
    {"id": "3", "label": "STP Client 11$", "targetAction": "Submit to BDM"},
    {"id": "4", "label": "Booster VIP 20$", "targetAction": "Submit to BDM"},
    {"id": "5", "label": "Booster IB 18$", "targetAction": "Submit to BDM"},
    {"id": "6", "label": "Booster Client 14$", "targetAction": "Submit to BDM"},
    {"id": "7", "label": "No Self Rebate", "targetAction": "Do Nothing"}
  ]'::jsonb, now())
ON CONFLICT (setting_key) DO UPDATE
SET setting_value = EXCLUDED.setting_value,
    updated_at = now();

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

-- ================================================================================
-- Table: profiles (Strict Role-Based Access Control Repository)
-- ================================================================================

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('superadmin', 'bdm')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Index on email & role for instant sub-millisecond query
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);

-- Enable Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Disable any legacy or conflicting recursive policies on profiles
DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Superadmins manage profiles" ON public.profiles;
DROP POLICY IF EXISTS "Service role manage profiles" ON public.profiles;
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.profiles;
DROP POLICY IF EXISTS "Allow individual read" ON public.profiles;

-- Policy 1: Authenticated users can read their own profile (auth.uid() = id)
-- ZERO recursion: Compares column id directly to auth.uid() without any subqueries
CREATE POLICY "Users can read own profile"
ON public.profiles
FOR SELECT
TO authenticated
USING (auth.uid() = id);

-- Helper function: Check if current authenticated user is superadmin
-- CRITICAL: SET row_security = off prevents PostgreSQL error 42P17 (infinite recursion)
CREATE OR REPLACE FUNCTION public.is_superadmin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'superadmin'
  );
$$;

-- Helper RPC: Return current user's role safely without RLS recursion
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.is_superadmin() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_my_role() TO authenticated, anon;

-- Policy 2: Allow superadmins to manage all profiles (immune to recursion due to SET row_security = off)
CREATE POLICY "Superadmins manage profiles"
ON public.profiles
FOR ALL
TO authenticated
USING (public.is_superadmin())
WITH CHECK (public.is_superadmin());

-- Trigger Function: Keep profiles in sync with auth.users
CREATE OR REPLACE FUNCTION public.handle_user_profile_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  assigned_role TEXT;
BEGIN
  IF NEW.email = 'boyintraderz@gmail.com' OR NEW.email = 'admin@owlfx.my' THEN
    assigned_role := 'superadmin';
  ELSIF NEW.email = 'daus@owlfx.my' THEN
    assigned_role := 'bdm';
  ELSE
    assigned_role := NULL;
  END IF;

  IF assigned_role IS NOT NULL THEN
    INSERT INTO public.profiles (id, email, role, updated_at)
    VALUES (NEW.id, NEW.email, assigned_role, now())
    ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        role = assigned_role,
        updated_at = now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT OR UPDATE OF email ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_user_profile_sync();

-- Direct Sync: Map existing auth.users to public.profiles for the 3 authorized accounts
INSERT INTO public.profiles (id, email, role, updated_at)
SELECT id, email,
  CASE
    WHEN email = 'boyintraderz@gmail.com' THEN 'superadmin'
    WHEN email = 'admin@owlfx.my' THEN 'superadmin'
    WHEN email = 'daus@owlfx.my' THEN 'bdm'
  END AS role,
  now()
FROM auth.users
WHERE email IN ('boyintraderz@gmail.com', 'admin@owlfx.my', 'daus@owlfx.my')
ON CONFLICT (id) DO UPDATE
SET role = EXCLUDED.role,
    email = EXCLUDED.email,
    updated_at = now();

NOTIFY pgrst, 'reload schema';
