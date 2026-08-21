/**
 * Config Centralizada — Caja Fresh POS
 * 
 * Carga variables de entorno desde .env usando dotenv.
 * Centraliza todas las credenciales y constantes en un solo lugar.
 * 
 * Uso: const config = require('./src/config');
 */

const path = require('path');
const fs = require('fs');

// Cargar .env explícitamente desde la raíz del proyecto
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
} else {
    console.warn('[CONFIG] ⚠️ Archivo .env no encontrado en:', envPath);
}

const config = {
    // ─── Supabase ──────────────────────────────────────────────
    supabase: {
        url: process.env.SUPABASE_URL || 'https://effgvevvnfzcuvtulyvs.supabase.co',
        key: process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVmZmd2ZXZ2bmZ6Y3V2dHVseXZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY5NTg0MzgsImV4cCI6MjA5MjUzNDQzOH0.0WzyJcGCuGYfJAIE9g1Gxcm5G4thooHxDV0a4D5jMVk',
    },

    // ─── OpenRouter ────────────────────────────────────────────
    openRouterApiKey: process.env.OPENROUTER_API_KEY || '',

    // ─── Túneles ───────────────────────────────────────────────
    cloudflare: {
        token: process.env.CLOUDFLARE_TOKEN || '',
        domain: process.env.CLOUDFLARE_DOMAIN || '',
    },
    ngrok: {
        authToken: process.env.NGROK_AUTH_TOKEN || '',
    },

    // ─── Entorno ───────────────────────────────────────────────
    nodeEnv: process.env.NODE_ENV || 'production',
    isDev: process.env.NODE_ENV === 'development',

    // ─── Mobile ────────────────────────────────────────────────
    mobile: {
        title: process.env.MOBILE_TITLE || 'PUNTO PILA',
        color: process.env.MOBILE_COLOR || '#2563eb',
    },

    // ─── App ───────────────────────────────────────────────────
    port: parseInt(process.env.POS_PORT, 10) || 3000,
};

module.exports = config;
