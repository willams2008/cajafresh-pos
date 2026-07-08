-- ==========================================
-- SUPABASE UPDATE: Tablas para Edición Remota de Precios
-- ==========================================
-- Ejecutar este SQL en: Supabase Dashboard → SQL Editor → New Query

-- 1. CATÁLOGO DE PRODUCTOS (Copia sincronizada)
CREATE TABLE IF NOT EXISTS store_products (
    id TEXT PRIMARY KEY, -- Formato: storeId_productId
    store_id TEXT REFERENCES stores(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL,
    name TEXT NOT NULL,
    price NUMERIC DEFAULT 0,
    cost NUMERIC DEFAULT 0,
    stock INTEGER DEFAULT 0,
    category TEXT DEFAULT 'General',
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. BANDEJA DE COMANDOS (Órdenes del Jefe hacia el POS)
CREATE TABLE IF NOT EXISTS store_commands (
    id BIGSERIAL PRIMARY KEY,
    store_id TEXT REFERENCES stores(id) ON DELETE CASCADE,
    command_type TEXT NOT NULL, -- Ej: 'UPDATE_PRICE'
    payload JSONB NOT NULL, -- Ej: {"product_id": "123", "new_price": 5.50}
    status TEXT DEFAULT 'pending', -- 'pending', 'done', 'error'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    executed_at TIMESTAMPTZ
);

-- ÍNDICES
CREATE INDEX IF NOT EXISTS idx_store_products_store ON store_products(store_id);
CREATE INDEX IF NOT EXISTS idx_store_commands_store ON store_commands(store_id, status);

-- PERMISOS Y SEGURIDAD
ALTER TABLE store_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_commands ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on store_products" ON store_products FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on store_commands" ON store_commands FOR ALL USING (true) WITH CHECK (true);
