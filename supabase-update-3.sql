-- ==========================================
-- SUPABASE UPDATE: Añadir columnas a store_commands
-- ==========================================
-- Ejecutar este SQL en: Supabase Dashboard → SQL Editor → New Query

-- Añadir columnas para seguimiento de ejecución y errores
ALTER TABLE store_commands ADD COLUMN IF NOT EXISTS executed_at TIMESTAMPTZ;
ALTER TABLE store_commands ADD COLUMN IF NOT EXISTS error_log TEXT;

-- Nota: Si las columnas ya existían, este comando no hará nada (gracias a IF NOT EXISTS)
