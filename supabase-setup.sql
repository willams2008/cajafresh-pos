-- ==========================================
-- SUPABASE SETUP: Tablas para Panel Multi-Sucursal (Completo)
-- ==========================================
-- Ejecutar este SQL en: Supabase Dashboard → SQL Editor → New Query

-- 1. TIENDAS (Registro de cada abasto/sucursal)
CREATE TABLE IF NOT EXISTS stores (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT 'Mi Tienda',
    brand_name TEXT DEFAULT 'Caja Fresh',
    last_seen TIMESTAMPTZ DEFAULT NOW(),
    status TEXT DEFAULT 'online',
    license_expiry TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. SNAPSHOTS (Resumen periódico de cada tienda)
CREATE TABLE IF NOT EXISTS store_snapshots (
    id BIGSERIAL PRIMARY KEY,
    store_id TEXT REFERENCES stores(id) ON DELETE CASCADE,
    date DATE DEFAULT CURRENT_DATE,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    total_ves NUMERIC DEFAULT 0,
    total_usd NUMERIC DEFAULT 0,
    tickets INTEGER DEFAULT 0,
    items_sold INTEGER DEFAULT 0,
    total_cost_usd NUMERIC DEFAULT 0,
    profit_usd NUMERIC DEFAULT 0,
    exchange_rate NUMERIC DEFAULT 0,
    products_count INTEGER DEFAULT 0,
    low_stock_count INTEGER DEFAULT 0,
    out_of_stock_count INTEGER DEFAULT 0,
    pending_credits INTEGER DEFAULT 0,
    methods JSONB DEFAULT '{}'
);

-- 3. VENTAS (Historial de ventas detallado)
CREATE TABLE IF NOT EXISTS store_sales (
    id TEXT PRIMARY KEY, -- Formato: {store_id}_{ticket}
    store_id TEXT REFERENCES stores(id) ON DELETE CASCADE,
    ticket TEXT,
    date DATE DEFAULT CURRENT_DATE,
    timestamp BIGINT,
    total_usd NUMERIC DEFAULT 0,
    total_ves NUMERIC DEFAULT 0,
    total_cost_usd NUMERIC DEFAULT 0,
    method TEXT DEFAULT 'cash-usd',
    client_name TEXT DEFAULT 'Cliente',
    client_document TEXT DEFAULT 'V-00000000',
    items_count INTEGER DEFAULT 0,
    items_json TEXT DEFAULT '[]',
    exchange_rate NUMERIC DEFAULT 0,
    status TEXT DEFAULT 'paid'
);

-- 4. GASTOS (Egresos por sucursal)
CREATE TABLE IF NOT EXISTS store_expenses (
    id TEXT PRIMARY KEY, -- Formato: {store_id}_{id}
    store_id TEXT REFERENCES stores(id) ON DELETE CASCADE,
    date DATE DEFAULT CURRENT_DATE,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    description TEXT,
    amount_usd NUMERIC DEFAULT 0,
    payment_method TEXT,
    reference_number TEXT,
    responsible_name TEXT
);

-- 5. PRODUCTOS (Catálogo espejo en la nube)
CREATE TABLE IF NOT EXISTS store_products (
    id TEXT PRIMARY KEY, -- Formato: {store_id}_{product_id}
    store_id TEXT REFERENCES stores(id) ON DELETE CASCADE,
    product_id TEXT,
    name TEXT,
    price NUMERIC DEFAULT 0,
    price_ves NUMERIC DEFAULT 0,
    cost NUMERIC DEFAULT 0,
    stock INTEGER DEFAULT 0,
    category TEXT DEFAULT 'General',
    img_url TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. ALERTAS DE STOCK
CREATE TABLE IF NOT EXISTS store_alerts (
    id TEXT PRIMARY KEY,
    store_id TEXT REFERENCES stores(id) ON DELETE CASCADE,
    product_id TEXT,
    product_name TEXT,
    alert_type TEXT DEFAULT 'low_stock',
    stock INTEGER DEFAULT 0,
    timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- 7. LIVE STATE (Vista en vivo del carrito actual)
CREATE TABLE IF NOT EXISTS store_live_state (
    store_id TEXT PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
    cart_data JSONB DEFAULT '[]',
    total_usd NUMERIC DEFAULT 0,
    total_ves NUMERIC DEFAULT 0,
    active_items INTEGER DEFAULT 0,
    current_view TEXT DEFAULT 'POS',
    last_activity TIMESTAMPTZ DEFAULT NOW()
);

-- 8. COMANDOS (Control remoto desde App Jefe)
CREATE TABLE IF NOT EXISTS store_commands (
    id BIGSERIAL PRIMARY KEY,
    store_id TEXT REFERENCES stores(id) ON DELETE CASCADE,
    command_type TEXT NOT NULL, -- UPDATE_PRICE, SYNC_NOW, etc.
    payload JSONB DEFAULT '{}',
    status TEXT DEFAULT 'pending', -- pending, done, error
    created_at TIMESTAMPTZ DEFAULT NOW(),
    executed_at TIMESTAMPTZ,
    error_log TEXT
);

-- 9. BACKUPS (Respaldos semanales)
CREATE TABLE IF NOT EXISTS store_backups (
    id BIGSERIAL PRIMARY KEY,
    store_id TEXT REFERENCES stores(id) ON DELETE CASCADE,
    backup_date TIMESTAMPTZ DEFAULT NOW(),
    products_json JSONB,
    clients_json JSONB,
    sales_summary_json JSONB
);

-- ÍNDICES para rendimiento
CREATE INDEX IF NOT EXISTS idx_snapshots_store ON store_snapshots(store_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_sales_store ON store_sales(store_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_store ON store_expenses(store_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_products_store ON store_products(store_id);
CREATE INDEX IF NOT EXISTS idx_commands_status ON store_commands(store_id, status);

-- Habilitar RLS (Row Level Security)
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_live_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_backups ENABLE ROW LEVEL SECURITY;

-- Políticas permisivas para desarrollo rápido (la seguridad la maneja el PIN en el Dashboard)
CREATE POLICY "Public Access" ON stores FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public Access" ON store_snapshots FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public Access" ON store_sales FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public Access" ON store_expenses FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public Access" ON store_products FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public Access" ON store_alerts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public Access" ON store_live_state FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public Access" ON store_commands FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public Access" ON store_backups FOR ALL USING (true) WITH CHECK (true);
