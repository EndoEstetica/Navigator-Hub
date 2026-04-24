-- ============================================================
-- Navigator Hubb — MIGRACJA NAPRAWCZA: Karta Pacjenta
-- Uruchom ten skrypt w Supabase SQL Editor, aby naprawić błąd "Błąd pobierania karty pacjenta"
-- ============================================================

-- 1. Tabela EVENTS — Dodanie brakujących kolumn wymaganych przez nowy backend
ALTER TABLE events ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'app';
ALTER TABLE events ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

-- 2. Tabela CONTACTS — Dodanie brakujących kolumn dla danych pacjenta i W0
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS contact_status TEXT DEFAULT 'new_lead';
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS ghl_stage_name TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS last_note TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS last_note_at TIMESTAMPTZ;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS first_call_at TIMESTAMPTZ;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS w0_scheduled BOOLEAN DEFAULT FALSE;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS w0_date TIMESTAMPTZ;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS w0_doctor TEXT;

-- 3. Indeksy dla wydajności (przyspieszają Timeline i Popup)
CREATE INDEX IF NOT EXISTS idx_events_source ON events(source);
CREATE INDEX IF NOT EXISTS idx_events_contact_time ON events(contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contacts_ghl_id ON contacts(ghl_contact_id);

-- 4. Tabela USER_ACTIVITY (jeśli nie została utworzona wcześniej)
CREATE TABLE IF NOT EXISTS user_activity (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         TEXT NOT NULL UNIQUE,
  user_name       TEXT,
  last_login_at   TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at    TIMESTAMPTZ DEFAULT NOW(),
  is_online       BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
