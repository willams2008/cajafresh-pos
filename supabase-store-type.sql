-- Agregar columna store_type a la tabla stores
ALTER TABLE stores ADD COLUMN IF NOT EXISTS store_type TEXT DEFAULT 'kiosko';

-- Agregar columnas faltantes a cashups (ejecutar en cada POS local via migración)
-- NOTA: Estas columnas ya se agregan automáticamente vía database.js ALTER TABLE
