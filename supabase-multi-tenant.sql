-- ============================================================
-- CAJA FRESH POS / SAAS — SUPABASE MULTI-TENANT MIGRATION
-- Versión: 2.0 (Aislamiento por Cliente / Tenant)
-- ============================================================
-- INSTRUCCIONES:
--   1. Ve a supabase.com → Tu proyecto → SQL Editor
--   2. Crea una "New Query"
--   3. Pega todo este código y presiona "Run"
--   4. Este script es IDEMPOTENTE (se puede correr varias veces de forma segura)
-- ============================================================

-- 1. TABLA DE EMPRESAS / CLIENTES (TENANTS)
CREATE TABLE IF NOT EXISTS tenants (
    id          TEXT PRIMARY KEY,              -- Ej: 'tenant_bodegon_perez'
    name        TEXT NOT NULL,                 -- Ej: 'Bodegón Pérez C.A.'
    plan        TEXT DEFAULT 'pro',            -- 'basic' | 'pro' | 'enterprise'
    status      TEXT DEFAULT 'active',         -- 'active' | 'suspended' | 'cancelled'
    contact_email TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Insertar tenant por defecto para migrar datos existentes
INSERT INTO tenants (id, name, plan, status)
VALUES ('tenant_default', 'Cliente Principal / Por Defecto', 'pro', 'active')
ON CONFLICT (id) DO NOTHING;


-- 2. AGREGAR COLUMNA tenant_id A TODAS LAS TABLAS DEL SISTEMA

DO $$ 
DECLARE
    tbl text;
    tables text[] := ARRAY[
        'stores',
        'store_snapshots',
        'store_sales',
        'store_expenses',
        'store_products',
        'store_alerts',
        'store_commands',
        'store_backups',
        'store_transfers',
        'store_purchase_orders',
        'store_live_state'
    ];
BEGIN
    FOREACH tbl IN ARRAY tables LOOP
        IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = tbl) THEN
            EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT %L;', tbl, 'tenant_default');
            EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_tenant_id ON %I (tenant_id);', tbl, tbl);
        END IF;
    END LOOP;
END $$;


-- 3. ÍNDICES COMPUESTOS PARA MULTI-TENANCY MULTI-SUCURSAL
CREATE INDEX IF NOT EXISTS idx_stores_tenant_store ON stores (tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_products_tenant_store ON store_products (tenant_id, store_id);
CREATE INDEX IF NOT EXISTS idx_products_tenant_product ON store_products (tenant_id, product_id);
CREATE INDEX IF NOT EXISTS idx_sales_tenant_store ON store_sales (tenant_id, store_id);
CREATE INDEX IF NOT EXISTS idx_expenses_tenant_store ON store_expenses (tenant_id, store_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_tenant_store ON store_snapshots (tenant_id, store_id);
CREATE INDEX IF NOT EXISTS idx_alerts_tenant_store ON store_alerts (tenant_id, store_id);
CREATE INDEX IF NOT EXISTS idx_commands_tenant_store ON store_commands (tenant_id, store_id);
CREATE INDEX IF NOT EXISTS idx_pos_tenant_store ON store_purchase_orders (tenant_id, from_store, to_store);
CREATE INDEX IF NOT EXISTS idx_transfers_tenant_store ON store_transfers (tenant_id, from_store, to_store);


-- 4. VISTA DE CONSULTA PARA APPS MÓVILES (Catálogo por Empresa)
CREATE OR REPLACE VIEW view_tenant_catalog AS
SELECT 
    p.tenant_id,
    p.store_id,
    p.product_id,
    p.name,
    p.price,
    p.price_ves,
    p.price_eur,
    p.promo_price,
    p.stock,
    p.category,
    p.img_url,
    p.updated_at,
    s.name AS store_name,
    s.brand_name
FROM store_products p
JOIN stores s ON p.store_id = s.id AND p.tenant_id = s.tenant_id;


-- 5. VISTA DE MÉTRICAS POR SUCURSAL PARA LA APP DEL JEFE
CREATE OR REPLACE VIEW view_store_metrics AS
SELECT 
    s.tenant_id,
    s.id AS store_id,
    s.name AS store_name,
    s.store_type,
    s.status,
    s.last_seen,
    COALESCE(SUM(sa.total_usd), 0) AS total_sales_usd,
    COALESCE(SUM(sa.total_ves), 0) AS total_sales_ves,
    COALESCE(COUNT(DISTINCT sa.id), 0) AS total_tickets,
    COALESCE((SELECT SUM(e.amount_usd) FROM store_expenses e WHERE e.store_id = s.id AND e.tenant_id = s.tenant_id), 0) AS total_expenses_usd,
    COALESCE((SELECT COUNT(*) FROM store_products p WHERE p.store_id = s.id AND p.tenant_id = s.tenant_id), 0) AS total_products_count
FROM stores s
LEFT JOIN store_sales sa ON s.id = sa.store_id AND s.tenant_id = sa.tenant_id
-- 6. COLUMNAS DE CAJERO Y AUDITORÍA EN TIEMPO REAL
DO $$ BEGIN
    ALTER TABLE store_sales ADD COLUMN IF NOT EXISTS cashier_name TEXT DEFAULT 'Cajero Principal';
    ALTER TABLE store_live_state ADD COLUMN IF NOT EXISTS cashier_name TEXT DEFAULT 'Cajero Activo';
    ALTER TABLE stores ADD COLUMN IF NOT EXISTS current_cashier TEXT DEFAULT 'Cajero Activo';
EXCEPTION WHEN OTHERS THEN NULL; END $$;


-- 7. VISTA DE MÉTRICAS DE EMPLEADOS / CAJEROS (Para la App del Jefe)
CREATE OR REPLACE VIEW view_employee_metrics AS
SELECT 
    sa.tenant_id,
    sa.store_id,
    COALESCE(sa.cashier_name, 'Cajero Principal') AS cashier_name,
    COUNT(sa.id) AS total_sales_count,
    SUM(sa.total_usd) AS total_sales_usd,
    SUM(sa.total_ves) AS total_sales_ves,
    AVG(sa.total_usd) AS avg_ticket_usd,
    MAX(sa.date) AS last_sale_at
FROM store_sales sa
GROUP BY sa.tenant_id, sa.store_id, COALESCE(sa.cashier_name, 'Cajero Principal');


-- 8. VISTA DE AUDITORÍA EN TIEMPO REAL / CAJA EN VIVO
CREATE OR REPLACE VIEW view_live_box_audit AS
SELECT 
    s.tenant_id,
    s.id AS store_id,
    s.name AS store_name,
    COALESCE(ls.cashier_name, s.current_cashier, 'Sin asignar') AS active_cashier,
    s.status AS connection_status,
    COALESCE(ls.current_view, 'POS') AS current_view,
    COALESCE(ls.active_items, 0) AS items_in_cart,
    COALESCE(ls.total_usd, 0) AS cart_total_usd,
    ls.last_activity
FROM stores s
LEFT JOIN store_live_state ls ON s.id = ls.store_id AND s.tenant_id = ls.tenant_id;
