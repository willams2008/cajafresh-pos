-- ==========================================
-- MIGRATION: License Activation System
-- Crea tablas: licenses, license_audit
-- ==========================================

CREATE TABLE IF NOT EXISTS licenses (
    machine_id TEXT PRIMARY KEY,
    app_id TEXT NOT NULL,
    device_name TEXT DEFAULT '',
    user_type TEXT DEFAULT 'negocio',
    membership_code TEXT DEFAULT '',
    license_code TEXT DEFAULT '',
    expiration_date TEXT DEFAULT '',
    status TEXT DEFAULT 'trial' CHECK (status IN ('trial','pending','active','deactivated')),
    deactivation_reason TEXT,
    user_info JSONB DEFAULT '{}',
    version TEXT DEFAULT '',
    last_seen TIMESTAMPTZ DEFAULT NOW(),
    trial_start TIMESTAMPTZ DEFAULT NOW(),
    trial_end TIMESTAMPTZ DEFAULT NOW() + INTERVAL '7 days',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_licenses_status ON licenses(status);
CREATE INDEX IF NOT EXISTS idx_licenses_membership ON licenses(membership_code);

CREATE TABLE IF NOT EXISTS license_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    machine_id TEXT NOT NULL REFERENCES licenses(machine_id) ON DELETE CASCADE,
    action TEXT NOT NULL CHECK (action IN ('registered','trial_started','activated','deactivated','heartbeat','expired','trial_expired')),
    reason TEXT,
    ip_address TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_license_audit_machine ON license_audit(machine_id);
CREATE INDEX IF NOT EXISTS idx_license_audit_action ON license_audit(action);

ALTER TABLE licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE license_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon insert licenses" ON licenses FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anon select licenses" ON licenses FOR SELECT USING (true);
CREATE POLICY "Allow anon update licenses" ON licenses FOR UPDATE USING (true);
CREATE POLICY "Allow anon insert audit" ON license_audit FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anon select audit" ON license_audit FOR SELECT USING (true);
