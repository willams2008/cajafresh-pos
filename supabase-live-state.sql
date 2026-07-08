-- ==========================================
-- SUPABASE UPDATE: Vista En Vivo (Live View)
-- ==========================================

CREATE TABLE IF NOT EXISTS store_live_state (
    store_id TEXT PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
    cart_data JSONB DEFAULT '[]',
    total_usd NUMERIC DEFAULT 0,
    total_ves NUMERIC DEFAULT 0,
    active_items INTEGER DEFAULT 0,
    last_activity TIMESTAMPTZ DEFAULT NOW(),
    current_view TEXT DEFAULT 'POS'
);

-- Habilitar RLS
ALTER TABLE store_live_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on store_live_state" ON store_live_state FOR ALL USING (true) WITH CHECK (true);
