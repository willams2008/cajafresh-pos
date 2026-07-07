/**
 * Entry Point del Renderer — Caja Fresh POS.
 *
 * Este archivo es el punto de entrada para esbuild.
 * Importa todos los módulos del renderer y los expone globalmente.
 *
 * Build: npm run build:renderer  →  genera app.js
 */

// @ts-check

// ─── Módulos base ──────────────────────────────────────────────
import './state.js';
import './utils.js';

// ─── Módulos de funcionalidad ──────────────────────────────────
import './inventory.js';
import './pos.js';
import './reports.js';

// ─── Estado global (backward compatibility) ────────────────────
import { state, loadPersistentState } from './state.js';

// ─── Inicialización cuando el DOM está listo ───────────────────
document.addEventListener('DOMContentLoaded', () => {
    loadPersistentState();
    console.log('[CAJA FRESH] Renderer modules loaded.');
});
