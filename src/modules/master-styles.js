/**
 * Master Styles — Estilos globales para todas las extensiones:
 * Dashboard, notifications, shortcuts, dark mode fixes, cash reconciliation
 */

(function() {
    if (document.getElementById('master-ext-styles')) return;

    var css = document.createElement('style');
    css.id = 'master-ext-styles';
    css.textContent = `

        /* ── DASHBOARD ── */
        .dash-greeting {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 24px;
            flex-wrap: wrap;
            gap: 12px;
        }
        .dash-greeting-title {
            font-size: 24px;
            font-weight: 800;
            color: #1e293b;
            margin: 0;
        }
        .dark .dash-greeting-title { color: #e2e8f0; }
        .dash-greeting-subtitle {
            font-size: 13px;
            color: #64748b;
            margin-top: 2px;
            font-weight: 500;
            text-transform: capitalize;
        }
        .dash-actions { display: flex; gap: 8px; flex-wrap: wrap; }
        .dash-btn {
            padding: 10px 18px;
            border-radius: 12px;
            border: none;
            font-size: 12px;
            font-weight: 700;
            cursor: pointer;
            transition: all 0.15s;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .dash-btn-primary { background: #6366f1; color: white; }
        .dash-btn-primary:hover { background: #4f46e5; transform: scale(1.02); }
        .dash-btn-secondary { background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0; }
        .dark .dash-btn-secondary { background: #1e293b; color: #94a3b8; border-color: #334155; }
        .dash-btn-secondary:hover { background: #e2e8f0; }

        .dash-kpis {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 12px;
            margin-bottom: 24px;
        }
        .dash-kpi {
            background: white;
            border-radius: 16px;
            padding: 16px 20px;
            display: flex;
            align-items: center;
            gap: 14px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.05);
            border: 1px solid #e2e8f0;
            transition: all 0.2s;
        }
        .dash-kpi:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.08); }
        .dark .dash-kpi { background: #1e293b; border-color: #334155; }
        .dash-kpi-icon {
            width: 44px;
            height: 44px;
            border-radius: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 18px;
            flex-shrink: 0;
        }
        .dash-kpi-sales .dash-kpi-icon { background: #eef2ff; color: #6366f1; }
        .dash-kpi-ves .dash-kpi-icon { background: #fef3c7; color: #d97706; }
        .dash-kpi-profit .dash-kpi-icon { background: #ecfdf5; color: #059669; }
        .dash-kpi-tickets .dash-kpi-icon { background: #fdf2f8; color: #e11d48; }
        .dash-kpi-body { }
        .dash-kpi-value { display: block; font-size: 20px; font-weight: 800; color: #1e293b; line-height: 1.2; }
        .dark .dash-kpi-value { color: #e2e8f0; }
        .dash-kpi-label { display: block; font-size: 10px; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 2px; }

        .dash-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 16px;
            margin-bottom: 24px;
        }
        @media (max-width: 768px) { .dash-grid { grid-template-columns: 1fr; } }
        .dash-section {
            background: white;
            border-radius: 16px;
            border: 1px solid #e2e8f0;
            overflow: hidden;
            box-shadow: 0 1px 3px rgba(0,0,0,0.04);
        }
        .dark .dash-section { background: #1e293b; border-color: #334155; }
        .dash-section-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 14px 18px;
            border-bottom: 1px solid #f1f5f9;
        }
        .dark .dash-section-header { border-color: #0f172a; }
        .dash-section-header h3 {
            font-size: 12px;
            font-weight: 800;
            color: #475569;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin: 0;
        }
        .dark .dash-section-header h3 { color: #94a3b8; }
        .dash-section-header h3 i { margin-right: 6px; color: #6366f1; }
        .dash-section-badge {
            font-size: 10px;
            font-weight: 700;
            color: #6366f1;
            background: #eef2ff;
            padding: 2px 10px;
            border-radius: 20px;
        }
        .dash-section-body { padding: 12px 18px; max-height: 320px; overflow-y: auto; }
        .dash-empty {
            text-align: center;
            padding: 24px 0;
            color: #94a3b8;
            font-size: 13px;
            font-style: italic;
        }

        .dash-sale-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 8px 0;
            border-bottom: 1px solid #f8fafc;
            gap: 8px;
        }
        .dark .dash-sale-row { border-color: #0f172a; }
        .dash-sale-row:last-child { border-bottom: none; }
        .dash-sale-left { display: flex; align-items: center; gap: 8px; }
        .dash-sale-ticket { font-weight: 800; font-size: 13px; color: #6366f1; }
        .dash-sale-time { font-size: 10px; color: #94a3b8; }
        .dash-sale-center { flex: 1; }
        .dash-sale-client { font-size: 12px; color: #475569; font-weight: 500; }
        .dark .dash-sale-client { color: #cbd5e1; }
        .dash-sale-right { text-align: right; }
        .dash-sale-amount { display: block; font-size: 14px; font-weight: 800; color: #059669; }
        .dash-sale-method { font-size: 9px; font-weight: 700; text-transform: uppercase; }
        .dash-method-cash-usd { color: #059669; }
        .dash-method-cash-ves { color: #2563eb; }
        .dash-method-card-ves { color: #7c3aed; }
        .dash-method-pago-movil { color: #9333ea; }

        .dash-alert {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 10px 14px;
            border-radius: 10px;
            margin-bottom: 8px;
        }
        .dash-alert:last-child { margin-bottom: 0; }
        .dash-alert-icon { font-size: 16px; width: 28px; text-align: center; }
        .dash-alert-body { flex: 1; }
        .dash-alert-title { font-size: 12px; font-weight: 700; }
        .dash-alert-text { font-size: 11px; margin-top: 2px; line-height: 1.4; }
        .dash-alert-action {
            background: none;
            border: 1px solid currentColor;
            border-radius: 6px;
            padding: 4px 10px;
            font-size: 10px;
            font-weight: 700;
            cursor: pointer;
            white-space: nowrap;
        }
        .dash-alert-action:hover { opacity: 0.8; }
        .dash-calc-section { margin-top: 8px; }

        /* ── SHORTCUTS HINT ── */
        .pos-shortcuts-hint {
            margin: 0 16px;
        }
        .shortcuts-bar {
            display: flex;
            gap: 12px;
            padding: 6px 12px;
            background: #f8fafc;
            border-radius: 8px;
            border: 1px solid #e2e8f0;
            flex-wrap: wrap;
        }
        .dark .shortcuts-bar { background: #1e293b; border-color: #334155; }
        .shortcut-item {
            font-size: 10px;
            color: #64748b;
            display: flex;
            align-items: center;
            gap: 4px;
        }
        .shortcut-item kbd {
            background: #e2e8f0;
            padding: 1px 6px;
            border-radius: 4px;
            font-size: 10px;
            font-weight: 700;
            color: #334155;
            font-family: inherit;
            border: 1px solid #cbd5e1;
        }
        .dark .shortcut-item kbd { background: #334155; color: #e2e8f0; border-color: #475569; }

        /* ── NOTIFICATIONS ── */
        .notif-badge {
            position: fixed;
            bottom: 30px;
            right: 30px;
            width: 44px;
            height: 44px;
            border-radius: 50%;
            background: #ef4444;
            color: white;
            font-size: 13px;
            font-weight: 800;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            box-shadow: 0 4px 16px rgba(239,68,68,0.4);
            z-index: 1000;
            transition: all 0.2s;
        }
        .notif-badge:hover { transform: scale(1.1); }

        .notif-quick-btn {
            background: #f1f5f9;
            border: 1px solid #e2e8f0;
            border-radius: 10px;
            padding: 8px 14px;
            cursor: pointer;
            font-size: 14px;
            color: #475569;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.15s;
            position: relative;
        }
        .dark .notif-quick-btn { background: #1e293b; border-color: #334155; color: #94a3b8; }
        .notif-quick-btn:hover { background: #6366f1; color: white; }
        .notif-quick-count {
            position: absolute;
            top: -4px;
            right: -4px;
            background: #ef4444;
            color: white;
            font-size: 9px;
            font-weight: 800;
            padding: 2px 6px;
            border-radius: 10px;
            min-width: 16px;
            text-align: center;
        }

        .notif-panel {
            position: fixed;
            bottom: 84px;
            right: 30px;
            width: 380px;
            max-height: 500px;
            background: white;
            border-radius: 16px;
            box-shadow: 0 8px 40px rgba(0,0,0,0.15);
            z-index: 1001;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            border: 1px solid #e2e8f0;
        }
        .dark .notif-panel { background: #1e293b; border-color: #334155; }
        .notif-panel.hidden { display: none; }
        .notif-panel-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 16px;
            border-bottom: 1px solid #f1f5f9;
        }
        .dark .notif-panel-header { border-color: #0f172a; }
        .notif-panel-title { font-size: 13px; font-weight: 800; color: #1e293b; }
        .dark .notif-panel-title { color: #e2e8f0; }
        .notif-panel-title i { margin-right: 6px; color: #6366f1; }
        .notif-panel-close {
            background: none;
            border: none;
            font-size: 16px;
            color: #94a3b8;
            cursor: pointer;
        }
        .notif-panel-body {
            overflow-y: auto;
            padding: 12px 16px;
            max-height: 400px;
        }
        .notif-empty { text-align: center; color: #94a3b8; font-size: 12px; padding: 24px 0; font-style: italic; }
        .notif-item {
            display: flex;
            gap: 10px;
            padding: 10px 12px;
            border-radius: 10px;
            margin-bottom: 6px;
            border-left: 3px solid;
        }
        .notif-item-icon { font-size: 14px; width: 24px; text-align: center; padding-top: 2px; }
        .notif-item-body { flex: 1; min-width: 0; }
        .notif-item-title { font-size: 11px; font-weight: 700; }
        .notif-item-text { font-size: 10px; color: #64748b; margin-top: 1px; }
        .notif-item-time { font-size: 9px; color: #94a3b8; margin-top: 2px; }
        .notif-item-action {
            background: none;
            border: none;
            font-size: 14px;
            color: #6366f1;
            cursor: pointer;
            padding: 4px;
            align-self: flex-start;
        }

        /* ── DARK MODE FIXES ── */
        .dark .dash-section-body::-webkit-scrollbar-track { background: #0f172a; }
        .dark .dash-section-body::-webkit-scrollbar-thumb { background: #334155; }
        .dark .rec-container { color: #e2e8f0; }
        .dark .swal2-popup { background: #1e293b !important; }
        .dark .swal2-title { color: #e2e8f0 !important; }
        .dark .swal2-html-container { color: #cbd5e1 !important; }
        .dark .swal2-input { background: #0f172a !important; color: #e2e8f0 !important; border-color: #334155 !important; }

        /* ── ANULAR VENTA: botón en tabla de reportes ── */
        .report-void-btn {
            color: #ef4444;
            background: #fef2f2;
            padding: 6px 10px;
            border-radius: 8px;
            border: none;
            font-size: 11px;
            font-weight: 700;
            cursor: pointer;
            transition: all 0.15s;
            display: inline-flex;
            align-items: center;
            gap: 4px;
        }
        .report-void-btn:hover {
            background: #fee2e2;
            transform: scale(1.05);
        }
    `;

    document.head.appendChild(css);
})();
