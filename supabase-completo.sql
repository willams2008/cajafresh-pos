-- ============================================================
-- PUNTO PILA POS — SUPABASE SETUP COMPLETO
-- Versión: Multi-Cliente SaaS
-- ============================================================
-- INSTRUCCIONES:
--   1. Ve a supabase.com → Tu proyecto → SQL Editor
--   2. Haz clic en "New Query"
--   3. Pega TODO este código y haz clic en "Run"
--   4. Debe decir "Success. No rows returned" en todas las secciones
-- ============================================================


-- ===========================================================
-- TABLA 1: STORES — Registro de cada sucursal/cliente
-- ===========================================================
CREATE TABLE IF NOT EXISTS stores (
    id             TEXT PRIMARY KEY,              -- Ej: store_catia01y
    name           TEXT NOT NULL DEFAULT 'Mi Tienda',
    brand_name     TEXT DEFAULT 'Punto Pila POS',
    last_seen      TIMESTAMPTZ DEFAULT NOW(),
    status         TEXT DEFAULT 'offline',        -- 'online' | 'offline'
    license_expiry DATE,                          -- Novedad: para alertas del proveedor
    created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Si la tabla ya existe, agregar la columna (ignorar error si ya existe)
DO $$ BEGIN
    ALTER TABLE stores ADD COLUMN license_expiry DATE;
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;


-- ===========================================================
-- TABLA 2: STORE_SNAPSHOTS — Resumen periódico de cada tienda
-- ===========================================================
CREATE TABLE IF NOT EXISTS store_snapshots (
    id                  BIGSERIAL PRIMARY KEY,
    store_id            TEXT REFERENCES stores(id) ON DELETE CASCADE,
    date                DATE DEFAULT CURRENT_DATE,
    timestamp           TIMESTAMPTZ DEFAULT NOW(),
    total_ves           NUMERIC DEFAULT 0,
    total_usd           NUMERIC DEFAULT 0,
    tickets             INTEGER DEFAULT 0,
    items_sold          INTEGER DEFAULT 0,
    total_cost_usd      NUMERIC DEFAULT 0,
    profit_usd          NUMERIC DEFAULT 0,
    exchange_rate       NUMERIC DEFAULT 0,
    products_count      INTEGER DEFAULT 0,
    low_stock_count     INTEGER DEFAULT 0,
    out_of_stock_count  INTEGER DEFAULT 0,
    pending_credits     INTEGER DEFAULT 0,
    methods             JSONB DEFAULT '{}'
);


-- ===========================================================
-- TABLA 3: STORE_SALES — Historial de ventas de todas las tiendas
-- ===========================================================
CREATE TABLE IF NOT EXISTS store_sales (
    id              TEXT PRIMARY KEY,
    store_id        TEXT REFERENCES stores(id) ON DELETE CASCADE,
    ticket          TEXT,
    date            TIMESTAMPTZ DEFAULT NOW(),
    timestamp       BIGINT,
    total_usd       NUMERIC DEFAULT 0,
    total_ves       NUMERIC DEFAULT 0,
    total_cost_usd  NUMERIC DEFAULT 0,
    method          TEXT DEFAULT 'cash-usd',
    client_name     TEXT DEFAULT 'Cliente',
    items_count     INTEGER DEFAULT 0,
    items_json      TEXT DEFAULT '[]',
    exchange_rate   NUMERIC DEFAULT 0,
    status          TEXT DEFAULT 'paid'
);


-- ===========================================================
-- TABLA 4: STORE_EXPENSES — Gastos del día por tienda
-- ===========================================================
CREATE TABLE IF NOT EXISTS store_expenses (
    id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    store_id         TEXT REFERENCES stores(id) ON DELETE CASCADE,
    expense_type     TEXT,                        -- alquiler, nomina, proveedor, etc.
    description      TEXT,
    amount_usd       NUMERIC DEFAULT 0,
    amount_ves       NUMERIC DEFAULT 0,
    payment_method   TEXT DEFAULT 'efectivo',     -- efectivo, pago-movil, zelle, etc.
    reference_number TEXT,                        -- Número de referencia del pago
    responsible_name TEXT,                        -- Quién autorizó el gasto
    date             DATE DEFAULT CURRENT_DATE,
    created_at       TIMESTAMPTZ DEFAULT NOW()
);


-- ===========================================================
-- TABLA 5: STORE_PRODUCTS — Catálogo sincronizado de productos
-- ===========================================================
CREATE TABLE IF NOT EXISTS store_products (
    id          TEXT PRIMARY KEY,     -- Formato: storeId_productId
    store_id    TEXT REFERENCES stores(id) ON DELETE CASCADE,
    product_id  TEXT NOT NULL,
    name        TEXT NOT NULL,
    img_url     TEXT,                 -- Imagen del producto
    price       NUMERIC DEFAULT 0,    -- Precio USD
    price_ves   NUMERIC DEFAULT 0,    -- Precio Bs
    price_eur   NUMERIC DEFAULT 0,    -- Precio EUR
    promo_price NUMERIC DEFAULT 0,    -- Precio de promoción
    cost        NUMERIC DEFAULT 0,
    stock       INTEGER DEFAULT 0,
    category    TEXT DEFAULT 'General',
    variants    TEXT,                 -- Variantes en texto plano o JSON
    expiry_date TEXT,                 -- Fecha de vencimiento
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);


-- ===========================================================
-- TABLA 6: STORE_ALERTS — Alertas de stock bajo por tienda
-- ===========================================================
CREATE TABLE IF NOT EXISTS store_alerts (
    id           TEXT PRIMARY KEY,
    store_id     TEXT REFERENCES stores(id) ON DELETE CASCADE,
    product_id   TEXT,
    product_name TEXT,
    alert_type   TEXT DEFAULT 'low_stock',  -- 'low_stock' | 'out_of_stock'
    stock        INTEGER DEFAULT 0,
    timestamp    TIMESTAMPTZ DEFAULT NOW()
);


-- ===========================================================
-- TABLA 7: STORE_COMMANDS — Bandeja de comandos Jefe → POS
-- ===========================================================
CREATE TABLE IF NOT EXISTS store_commands (
    id            BIGSERIAL PRIMARY KEY,
    store_id      TEXT REFERENCES stores(id) ON DELETE CASCADE,
    command_type  TEXT NOT NULL,
    payload       JSONB NOT NULL DEFAULT '{}',
    status        TEXT DEFAULT 'pending',
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    executed_at   TIMESTAMPTZ,
    error_log     TEXT
);

-- ===========================================================
-- TABLA 8: STORE_BACKUPS — Copias de seguridad automáticas
-- ===========================================================
CREATE TABLE IF NOT EXISTS store_backups (
    id                 BIGSERIAL PRIMARY KEY,
    store_id           TEXT REFERENCES stores(id) ON DELETE CASCADE,
    backup_date        TIMESTAMPTZ DEFAULT NOW(),
    products_json      JSONB,
    clients_json       JSONB,
    sales_summary_json JSONB
);


-- ===========================================================
-- ÍNDICES — Para rendimiento en consultas frecuentes
-- ===========================================================
CREATE INDEX IF NOT EXISTS idx_snapshots_store    ON store_snapshots(store_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_sales_store        ON store_sales(store_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_sales_date         ON store_sales(date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_store     ON store_expenses(store_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_store       ON store_alerts(store_id);
CREATE INDEX IF NOT EXISTS idx_products_store     ON store_products(store_id);
CREATE INDEX IF NOT EXISTS idx_commands_pending   ON store_commands(store_id, status);
CREATE INDEX IF NOT EXISTS idx_backups_store      ON store_backups(store_id, backup_date);


-- ===========================================================
-- ROW LEVEL SECURITY — Habilitar en todas las tablas
-- ===========================================================
ALTER TABLE stores          ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_sales     ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_expenses  ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_products  ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_alerts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_commands  ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_backups   ENABLE ROW LEVEL SECURITY;


-- ===========================================================
-- POLÍTICAS DE ACCESO — Permiten lectura/escritura con anon key
-- (La seguridad real la maneja el PIN del panel del Jefe)
-- ===========================================================
DO $$ BEGIN
    -- stores
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='stores' AND policyname='Allow all on stores') THEN
        CREATE POLICY "Allow all on stores" ON stores FOR ALL USING (true) WITH CHECK (true);
    END IF;
    -- store_snapshots
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='store_snapshots' AND policyname='Allow all on snapshots') THEN
        CREATE POLICY "Allow all on snapshots" ON store_snapshots FOR ALL USING (true) WITH CHECK (true);
    END IF;
    -- store_sales
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='store_sales' AND policyname='Allow all on sales') THEN
        CREATE POLICY "Allow all on sales" ON store_sales FOR ALL USING (true) WITH CHECK (true);
    END IF;
    -- store_expenses
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='store_expenses' AND policyname='Allow all on expenses') THEN
        CREATE POLICY "Allow all on expenses" ON store_expenses FOR ALL USING (true) WITH CHECK (true);
    END IF;
    -- store_products
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='store_products' AND policyname='Allow all on store_products') THEN
        CREATE POLICY "Allow all on store_products" ON store_products FOR ALL USING (true) WITH CHECK (true);
    END IF;
    -- store_alerts
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='store_alerts' AND policyname='Allow all on alerts') THEN
        CREATE POLICY "Allow all on alerts" ON store_alerts FOR ALL USING (true) WITH CHECK (true);
    END IF;
    -- store_commands
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='store_commands' AND policyname='Allow all on store_commands') THEN
        CREATE POLICY "Allow all on store_commands" ON store_commands FOR ALL USING (true) WITH CHECK (true);
    END IF;
    -- store_backups
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='store_backups' AND policyname='Allow all on store_backups') THEN
        CREATE POLICY "Allow all on store_backups" ON store_backups FOR ALL USING (true) WITH CHECK (true);
    END IF;
END $$;


-- ===========================================================
-- RECARGAR CACHÉ DE ESQUEMA (evita errores 205 en PostgREST)
-- ===========================================================
NOTIFY pgrst, 'reload schema';


-- ===========================================================
-- ✅ VERIFICACIÓN — Muestra todas las tablas creadas
-- ===========================================================
SELECT table_name, 
       (SELECT COUNT(*) FROM information_schema.columns c 
        WHERE c.table_name = t.table_name 
          AND c.table_schema = 'public') AS columnas
FROM information_schema.tables t
WHERE table_schema = 'public' 
  AND table_name IN ('stores','store_snapshots','store_sales','store_expenses','store_products','store_alerts','store_commands','store_backups')
ORDER BY table_name;

-- ===========================================================
-- 🛠️ MIGRACIÓN RÁPIDA (Si ya tienes las tablas y quieres actualizarlas)
-- Pega esto si te faltan columnas en store_products:
-- ===========================================================
/*
ALTER TABLE store_products ADD COLUMN IF NOT EXISTS img_url TEXT;
ALTER TABLE store_products ADD COLUMN IF NOT EXISTS price_ves NUMERIC DEFAULT 0;
ALTER TABLE store_products ADD COLUMN IF NOT EXISTS price_eur NUMERIC DEFAULT 0;
ALTER TABLE store_products ADD COLUMN IF NOT EXISTS promo_price NUMERIC DEFAULT 0;
ALTER TABLE store_products ADD COLUMN IF NOT EXISTS variants TEXT;
ALTER TABLE store_products ADD COLUMN IF NOT EXISTS expiry_date TEXT;
*/
