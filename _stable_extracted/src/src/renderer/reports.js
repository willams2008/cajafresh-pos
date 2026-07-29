/**
 * Módulo de Reportes — Dashboard, Arqueo de Caja, Historial Diario.
 */

// @ts-check

import { state } from './state.js';
import { formatMoney, roundTo } from './utils.ts';

export function buildDailyReport(sales) {
    const today = sales.filter(s => {
        const sDate = new Date(s.date || s.timestamp).toDateString();
        return sDate === new Date().toDateString() && s.status !== 'void';
    });

    const totalUSD = today.reduce((sum, s) => sum + parseFloat(s.totalUSD || s.total || 0), 0);
    const totalVES = today.reduce((sum, s) => sum + parseFloat(s.totalVES || 0), 0);
    const tickets = today.length;
    const items = today.reduce((sum, s) => {
        const itemsList = typeof s.items === 'string' ? JSON.parse(s.items) : (s.items || []);
        return sum + itemsList.reduce((a, i) => a + (i.qty || 0), 0);
    }, 0);

    const byMethod = today.reduce((acc, s) => {
        const method = s.method || 'Otro';
        if (!acc[method]) acc[method] = { count: 0, totalUSD: 0, totalVES: 0 };
        acc[method].count++;
        acc[method].totalUSD += parseFloat(s.totalUSD || s.total || 0);
        acc[method].totalVES += parseFloat(s.totalVES || 0);
        return acc;
    }, {});

    return {
        totalUSD: roundTo(totalUSD, 2),
        totalVES: roundTo(totalVES, 2),
        tickets,
        items,
        byMethod,
        sales: today,
    };
}

export function renderReportsView() {
    const container = document.getElementById('reports-content');
    if (!container) return;

    const report = buildDailyReport(state.sales);
    // Implementación visual pendiente
    console.warn('[REPORTS] renderReportsView() parcialmente implementado');
}

/**
 * Genera el cierre de caja (Z Report).
 */
export async function closeCashup(data) {
    try {
        const sid = state.getStoreId ? state.getStoreId() : '';
        const cashup = {
            id: `cashup_${Date.now()}`,
            date: new Date().toISOString(),
            cash_usd: data.cashUSD || 0,
            cash_ves: data.cashVES || 0,
            sales_usd: data.salesUSD || 0,
            sales_ves: data.salesVES || 0,
            diff_usd: data.diffUSD || 0,
            cashier_name: data.cashierName || 'Cajero',
            notes: data.notes || '',
        };
        await window.electronAPI.db.saveCashup(sid, cashup);
        return { success: true };
    } catch (err) {
        console.error('[REPORTS] Error al cerrar caja:', err);
        return { success: false, error: err.message };
    }
}

if (typeof window !== 'undefined') {
    window.reportsModule = {
        buildDailyReport,
        renderReportsView,
        closeCashup,
    };
}
