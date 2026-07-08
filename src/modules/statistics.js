/**
 * Statistics Module
 * Renderizado de KPIs y analíticas del negocio (Dashboard de Rendimientos).
 */

window.Statistics = (function() {

    // Función Helper para Alertas de Negocio via WhatsApp
    function sendBusinessAlert(message) {
        // window.settings and formatUSD should be available globally from app.js
        const rawPhone = localStorage.getItem('boss_phone') || (window.settings && window.settings.bossPhone) || '';
        const phone = window.normalizeVEPhone ? window.normalizeVEPhone(rawPhone) : rawPhone;
        if (!phone) return;

        if (window.electronAPI && window.electronAPI.sendWhatsAppBackground) {
            window.electronAPI.sendWhatsAppBackground(phone, message)
                .then(res => console.log('[BI-ALERT] Notificación enviada'))
                .catch(err => console.error('[BI-ALERT] Error enviando notification', err));
        }
    }

    function renderAnalytics() {
        const products = window.products || [];
        const sales = window.sales || [];
        const dailyHistory = window.dailyHistory || [];
        const expenses = window.expenses || [];
        const settings = window.settings || {};
        const formatUSD = window.formatUSD || (val => '$' + Number(val).toFixed(2));

        // 1. Inversión en Stock (Stock * Costo)
        const inventoryValue = products.reduce((acc, p) => acc + ((Number(p.stock) || 0) * (Number(p.costPrice) || 0)), 0);
        const valEl = document.getElementById('ana-inventory-value');
        if (valEl) valEl.textContent = formatUSD(inventoryValue);

        // 2. Utilidad Acumulada Histórica
        const totalProfitHistory = dailyHistory.reduce((acc, d) => acc + (Number(d.profitUSD) || 0), 0);
        
        // Calcular ganancia del día, retro-aplicando costos si la venta se guardó sin ellos
        let recalculatedDayProfit = 0;
        sales.forEach(s => {
            let saleCost = Number(s.totalCostUSD) || 0;
            if (saleCost === 0 && Array.isArray(s.items)) {
                // Retro-calcular costo basado en el inventario actual
                saleCost = s.items.reduce((accItem, item) => {
                    const prod = products.find(p => p.id === item.id || p.id === item.parentId);
                    return accItem + ((Number(prod?.costPrice) || 0) * (Number(item.qty) || 0));
                }, 0);
            }
            recalculatedDayProfit += ((Number(s.totalUSD) || 0) - saleCost);
        });
        const currDayProfit = recalculatedDayProfit;

        const profEl = document.getElementById('ana-total-profit');
        if (profEl) profEl.textContent = formatUSD(totalProfitHistory + currDayProfit);

        // 3. Margen Promedio Real
        const totalSalesHistory = dailyHistory.reduce((acc, d) => acc + (Number(d.salesUSD) || 0), 0);
        const daySales = sales.reduce((acc, s) => acc + (Number(s.totalUSD) || 0), 0);
        const totalSalesAll = totalSalesHistory + daySales;
        const avgMargin = totalSalesAll > 0 ? ((totalProfitHistory + currDayProfit) / totalSalesAll) * 100 : 0;
        const margEl = document.getElementById('ana-average-margin');
        if (margEl) margEl.textContent = (isNaN(avgMargin) ? 0 : avgMargin).toFixed(1) + '%';

        // 4. Ranking de Productos más Rentables
        const prodStats = {};
        sales.forEach(s => {
            if (!Array.isArray(s.items)) return;
            s.items.forEach(i => {
                if (!prodStats[i.id]) prodStats[i.id] = { name: i.name, qty: 0, profit: 0, cost: 0 };
                const prod = products.find(p => p.id === i.id);
                const cost = Number(prod?.costPrice) || 0;
                const itemPrice = Number(i.unitPriceUSD || i.price) || 0;
                const itemQty = Number(i.qty) || 0;
                prodStats[i.id].qty += itemQty;
                prodStats[i.id].profit += (itemPrice - cost) * itemQty;
                prodStats[i.id].cost = cost;
            });
        });

        const ranking = Object.values(prodStats).sort((a,b) => b.profit - a.profit).slice(0, 5);
        const rankingBody = document.getElementById('ana-top-products-body');
        if (rankingBody) {
            rankingBody.innerHTML = ranking.length ? ranking.map(p => {
                const unitProfit = p.qty > 0 ? p.profit / p.qty : 0;
                const unitCost = p.cost;
                const margin = (unitProfit + unitCost) > 0 ? (unitProfit / (unitProfit + unitCost)) * 100 : 0;
                const safeMargin = isNaN(margin) ? 0 : margin.toFixed(0);

                return `
                    <tr>
                        <td class="py-4 px-8 font-bold text-slate-700">${p.name}</td>
                        <td class="py-4 px-8 text-center font-medium text-slate-500">${p.qty}</td>
                        <td class="py-4 px-8 text-center"><span class="px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded font-bold">${safeMargin}%</span></td>
                        <td class="py-4 px-8 text-right font-black text-slate-800">${formatUSD(p.profit || 0)}</td>
                    </tr>
                `;
            }).join('') : '<tr><td colspan="4" class="py-10 text-center text-slate-400 italic">No hay ventas registradas aún hoy</td></tr>';
        }

        // 5. Gráficos de Tendencia y Eficiencia
        if (window.Charts && window.Charts.renderAnalyticsCharts) {
            window.Charts.renderAnalyticsCharts(currDayProfit);
        }

        // 5b. Gráficos de Categoría y Métodos de Pago (movidos desde Reporte de Caja)
        if (window._lastCatTotals && window._lastMethodTotals) {
            if (window.Charts && window.Charts.renderInternalCharts) {
                window.Charts.renderInternalCharts(window._lastCatTotals, window._lastMethodTotals);
            }
        } else {
            // Recalcular si no hay cache (primera vez que se abre Rendimientos sin pasar por Reportes)
            let catTotals = {};
            let methodTotals = { 'cash-usd': 0, 'cash-ves': 0, 'card-ves': 0 };
            sales.forEach(sale => {
                methodTotals[sale.method] = (methodTotals[sale.method] || 0) + (Number(sale.totalVES) || 0);
                if (!Array.isArray(sale.items)) return;
                sale.items.forEach(item => {
                    catTotals[item.category] = (catTotals[item.category] || 0) + ((Number(item.unitPriceVES) || 0) * (Number(item.qty) || 0));
                });
            });
            if (window.Charts && window.Charts.renderInternalCharts) {
                window.Charts.renderInternalCharts(catTotals, methodTotals);
            }
        }

        // 6. NUEVO: Punto de Equilibrio y Proyecciones (Analytics 2.0)
        // Asegurar que expenses esté definido
        const expensesList = typeof expenses !== 'undefined' && Array.isArray(expenses) ? expenses : [];
        const totalExpensesUSD = expensesList.reduce((acc, e) => acc + (Number(e.amountUSD) || 0), 0);
        const avgMarginRate = (isNaN(avgMargin) || avgMargin <= 0) ? 0.3 : (avgMargin / 100);
        
        // Punto de Equilibrio: Cuánto necesito vender para cubrir gastos
        const breakEvenSales = totalExpensesUSD / (avgMarginRate > 0 ? avgMarginRate : 0.01);
        const bePercent = breakEvenSales > 0 ? Math.min(100, (daySales / breakEvenSales) * 100) : 100;
        
        const beStatusEl = document.getElementById('ana-be-status');
        const bePercentEl = document.getElementById('ana-be-percent');
        const beBarEl = document.getElementById('ana-be-bar');
        
        if (beStatusEl) {
            if (totalExpensesUSD === 0) {
                beStatusEl.textContent = "Registra gastos para calcular el punto de equilibrio";
                beStatusEl.classList.remove('text-emerald-600');
            } else if (daySales >= breakEvenSales) {
                beStatusEl.textContent = "¡Meta Alcanzada! (Ganancia neta)";
                beStatusEl.classList.add('text-emerald-600');
            } else {
                beStatusEl.textContent = `Faltan ${formatUSD(breakEvenSales - daySales)} para ser rentable hoy`;
                beStatusEl.classList.remove('text-emerald-600');
            }
        }
        
        const displayPercent = totalExpensesUSD === 0 ? 0 : bePercent;
        if (bePercentEl) bePercentEl.textContent = (isNaN(displayPercent) ? 0 : displayPercent).toFixed(0) + '%';
        if (beBarEl) beBarEl.style.width = (isNaN(displayPercent) ? 0 : displayPercent) + '%';

        // TRIGGER: Notificación WhatsApp Punto de Equilibrio (NUEVO)
        const alertKey = `be_alert_${new Date().toLocaleDateString()}`;
        if (totalExpensesUSD > 0 && daySales >= breakEvenSales && !localStorage.getItem(alertKey)) {
            sendBusinessAlert(`💰 *META ALCANZADA*: Hoy has superado el punto de equilibrio administrativo.\n*Ventas*: ${formatUSD(daySales)}\n*Status*: Operando en ganancia neta.`);
            localStorage.setItem(alertKey, 'sent');
        }

        // 7. Cierre Proyectado (Mes)
        const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
        const currentDay = new Date().getDate();
        const history7 = dailyHistory.slice(-7);
        
        // Incluir las ventas de hoy en el promedio para que la proyección no sea 0 si el historial está vacío
        const totalRecentSales = history7.reduce((acc, d) => acc + (Number(d.salesUSD) || 0), 0) + daySales;
        const daysCount = history7.length + (daySales > 0 ? 1 : 0) || 1; // Evitar división por cero
        const avgDailySales = totalRecentSales / daysCount;
        
        const projectedSales = ((isNaN(avgDailySales) ? 0 : avgDailySales) * daysInMonth);
        const projEl = document.getElementById('ana-projection-value');
        if (projEl) projEl.textContent = formatUSD(projectedSales);

        // 8. Inteligencia de Negocio: Capital Muerto e Insights
        const insightsContainer = document.getElementById('ana-insights-container');
        if (insightsContainer) {
            let insightsHTML = '';
            
            // Detección de Capital Muerto (Productos con stock que no se han vendido en los últimos 7 días)
            const soldInHistoryIds = new Set();
            history7.forEach(d => {
                // Nota: dailyHistory no tiene items detallados, usaremos una lógica de 'baja rotación' basada en ventas actuales
            });
            
            // Simulación lógica de insight: Productos con stock significativo que no se han vendido hoy
            const slowMovers = products.filter(p => p.stock > 0 && !prodStats[p.id]).sort((a,b) => (b.stock * b.costPrice) - (a.stock * a.costPrice)).slice(0, 2);
            const totalDeadValue = slowMovers.reduce((acc, p) => acc + (p.stock * p.costPrice), 0);
            
            if (slowMovers.length > 0 && totalDeadValue > 0) {
                insightsHTML += `
                    <div class="flex gap-4 animate-fadeIn">
                        <div class="w-10 h-10 shrink-0 bg-rose-500/20 rounded-xl flex items-center justify-center text-rose-400">
                            <i class="fas fa-exclamation-triangle"></i>
                        </div>
                        <div>
                            <p class="text-xs font-bold text-rose-300 mb-1">Capital Muerto Detectado</p>
                            <p class="text-[10px] text-slate-400 leading-relaxed">
                                Tienes <b>${formatUSD(totalDeadValue)}</b> atrapados en stock que no se mueve hoy. 
                                Específicamente: ${slowMovers.map(p => `<b>${p.name}</b> (x${p.stock})`).join(' y ')}.
                            </p>
                        </div>
                    </div>
                `;
            }

            // Rendimiento de Gastos
            if (totalExpensesUSD > 0 && currDayProfit > 0) {
                const expenseRatio = (totalExpensesUSD / currDayProfit) * 100;
                if (expenseRatio > 50) {
                    insightsHTML += `
                        <div class="flex gap-4 animate-fadeIn">
                            <div class="w-10 h-10 shrink-0 bg-amber-500/20 rounded-xl flex items-center justify-center text-amber-400">
                                <i class="fas fa-wallet"></i>
                            </div>
                            <div>
                                <p class="text-xs font-bold text-amber-300 mb-1">Alerta de Gastos</p>
                                <p class="text-[10px] text-slate-400 leading-relaxed">
                                    Los gastos de hoy (<b>${formatUSD(totalExpensesUSD)}</b>) consumen el <b>${expenseRatio.toFixed(0)}%</b> de tu utilidad. 
                                    Considera optimizar costos operativos.
                                </p>
                            </div>
                        </div>
                    `;
                }
            }

            // Success Insight
            if (daySales > avgDailySales * 1.05) {
                const growthDiff = daySales - avgDailySales;
                insightsHTML += `
                    <div class="flex gap-4 animate-fadeIn">
                        <div class="w-10 h-10 shrink-0 bg-emerald-500/20 rounded-xl flex items-center justify-center text-emerald-400">
                            <i class="fas fa-rocket"></i>
                        </div>
                        <div>
                            <p class="text-xs font-bold text-emerald-300 mb-1">Crecimiento Detectado</p>
                            <p class="text-[10px] text-slate-400 leading-relaxed">
                                ¡Gran jornada! Estás vendiendo <b>${formatUSD(growthDiff)}</b> más que tu promedio diario habitual.
                            </p>
                        </div>
                    </div>
                `;
            }

            insightsContainer.innerHTML = insightsHTML || '<p class="text-xs text-slate-500 italic text-center">Analizando datos... No hay alertas críticas hoy.</p>';
        }

        // 9. Capacidad de Reposición (Sugerencia)
        const replenishEl = document.getElementById('ana-replenish-advice');
        if (replenishEl) {
            const safeReinvest = currDayProfit * 0.7; // Deja el 30% como ganancia neta segura
            replenishEl.textContent = `Puedes reinvertir hasta ${formatUSD(safeReinvest)} en mercancía manteniendo el flujo de caja estable.`;
        }

        // 10. NUEVO: Hiper-Realismo (Fase 3)
        
        // A. Días de Cobertura (Inventory Runway)
        const avgDailyItemsCost = history7.length ? history7.reduce((acc, d) => acc + (d.salesUSD - (d.profitUSD || 0)), 0) / history7.length : (daySales * 0.7);
        const runwayDays = inventoryValue / (avgDailyItemsCost || 1);
        const runwayEl = document.getElementById('ana-inventory-runway');
        if (runwayEl) {
            runwayEl.textContent = `${runwayDays.toFixed(0)} días de stock`;
            if (runwayDays < 5) {
                runwayEl.className = "px-2 py-0.5 bg-rose-50 text-rose-700 text-[10px] font-black rounded-lg border border-rose-100 animate-pulse";
            } else {
                runwayEl.className = "px-2 py-0.5 bg-brand-50 text-brand-700 text-[10px] font-black rounded-lg border border-brand-100";
            }
        }

        // B. Resiliencia de Tasa (Ajuste por Inflación en USD/VES)
        const lastSnapshot = dailyHistory[dailyHistory.length - 1];
        const resEl = document.getElementById('ana-rate-resilience');
        if (resEl && lastSnapshot) {
            const rateDiff = settings.exchangeRate - (lastSnapshot.exchangeRate || settings.exchangeRate);
            resEl.classList.remove('hidden');
            if (rateDiff > 0.5) { // Si la tasa subió más de 0.50 VES
                resEl.textContent = "ALERTA TASA 📉";
                resEl.className = "text-[9px] font-black uppercase tracking-tighter px-1.5 py-0.5 rounded-md border bg-rose-500 text-white border-rose-600 animate-bounce";
                
                // Insight de ajuste
                if (insightsContainer) {
                    const lossPercent = (rateDiff / settings.exchangeRate) * 100;
                    insightsContainer.innerHTML += `
                        <div class="flex gap-4 animate-fadeIn">
                            <div class="w-10 h-10 shrink-0 bg-rose-500/10 rounded-xl flex items-center justify-center text-rose-500">
                                <i class="fas fa-chart-line"></i>
                            </div>
                            <div>
                                <p class="text-xs font-bold text-rose-300 mb-1">Riesgo de Reposición</p>
                                <p class="text-[10px] text-slate-400 leading-relaxed">La tasa subió un ${lossPercent.toFixed(1)}%. Tu utilidad real es menor a la nominal. Revisa precios de costo.</p>
                            </div>
                        </div>
                    `;
                }
            } else {
                resEl.textContent = "TASA ESTABLE 📈";
                resEl.className = "text-[9px] font-black uppercase tracking-tighter px-1.5 py-0.5 rounded-md border bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
            }
        }

        // Insight de Reabastecimiento Crítico
        if (runwayDays < 3 && insightsContainer) {
            insightsContainer.innerHTML += `
                <div class="flex gap-4 animate-fadeIn">
                    <div class="w-10 h-10 shrink-0 bg-brand-500/20 rounded-xl flex items-center justify-center text-brand-400">
                        <i class="fas fa-truck-loading"></i>
                    </div>
                    <div>
                        <p class="text-xs font-bold text-brand-300 mb-1">Reabastecimiento Crítico</p>
                        <p class="text-[10px] text-slate-400 leading-relaxed">Tu inventario se agotará en menos de 3 días al ritmo actual de ventas.</p>
                    </div>
                </div>
            `;
        }
    }

    return {
        renderAnalytics
    };
})();
