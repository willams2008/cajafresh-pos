window.Statistics = (function() {
    function formatUSD(val) {
        if (isNaN(val)) val = 0;
        return '$' + Number(val).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
    }

    function calculateInventoryValue(products) {
        return (products || []).reduce(function(acc, p) {
            return acc + ((Number(p.stock) || 0) * (Number(p.costPrice) || 0));
        }, 0);
    }

    function calculateDayProfit(sales, products) {
        var profit = 0;
        (sales || []).forEach(function(s) {
            var saleCost = Number(s.totalCostUSD) || 0;
            if (saleCost === 0 && Array.isArray(s.items)) {
                saleCost = s.items.reduce(function(accItem, item) {
                    var prod = (products || []).find(function(p) { return p.id === item.id || p.id === item.parentId; });
                    return accItem + ((Number(prod && prod.costPrice) || 0) * (Number(item.qty) || 0));
                }, 0);
            }
            profit += ((Number(s.totalUSD) || 0) - saleCost);
        });
        return profit;
    }

    function calculateBreakEven(totalExpensesUSD, avgMarginRate, daySales) {
        var breakEvenSales = totalExpensesUSD / (avgMarginRate > 0 ? avgMarginRate : 0.01);
        var bePercent = breakEvenSales > 0 ? Math.min(100, (daySales / breakEvenSales) * 100) : 100;
        return { breakEvenSales: breakEvenSales, bePercent: bePercent };
    }

    function calculateProductRanking(sales, products) {
        var prodStats = {};
        (sales || []).forEach(function(s) {
            if (!Array.isArray(s.items)) return;
            s.items.forEach(function(i) {
                if (!prodStats[i.id]) prodStats[i.id] = { name: i.name, qty: 0, profit: 0, cost: 0 };
                var prod = (products || []).find(function(p) { return p.id === i.id; });
                var cost = Number(prod && prod.costPrice) || 0;
                var itemPrice = Number(i.unitPriceUSD || i.price) || 0;
                var itemQty = Number(i.qty) || 0;
                prodStats[i.id].qty += itemQty;
                prodStats[i.id].profit += (itemPrice - cost) * itemQty;
                prodStats[i.id].cost = cost;
            });
        });
        return Object.values(prodStats).sort(function(a, b) { return b.profit - a.profit; }).slice(0, 5);
    }

    function renderAnalytics() {
        var products = window.products || [];
        var sales = window.sales || [];
        var dailyHistory = window.dailyHistory || [];
        var expenses = window.expenses || [];
        var settings = window.settings || {};

        var inventoryValue = calculateInventoryValue(products);
        var valEl = document.getElementById('ana-inventory-value');
        if (valEl) valEl.textContent = formatUSD(inventoryValue);

        var totalProfitHistory = dailyHistory.reduce(function(acc, d) { return acc + (Number(d.profitUSD) || 0); }, 0);
        var currDayProfit = calculateDayProfit(sales, products);

        var profEl = document.getElementById('ana-total-profit');
        if (profEl) profEl.textContent = formatUSD(totalProfitHistory + currDayProfit);

        var totalSalesHistory = dailyHistory.reduce(function(acc, d) { return acc + (Number(d.salesUSD) || 0); }, 0);
        var daySales = sales.reduce(function(acc, s) { return acc + (Number(s.totalUSD) || 0); }, 0);
        var totalSalesAll = totalSalesHistory + daySales;
        var avgMargin = totalSalesAll > 0 ? ((totalProfitHistory + currDayProfit) / totalSalesAll) * 100 : 0;
        var margEl = document.getElementById('ana-average-margin');
        if (margEl) margEl.textContent = (isNaN(avgMargin) ? 0 : avgMargin).toFixed(1) + '%';

        var ranking = calculateProductRanking(sales, products);
        var rankingBody = document.getElementById('ana-top-products-body');
        if (rankingBody) {
            rankingBody.innerHTML = ranking.length ? ranking.map(function(p) {
                var unitProfit = p.qty > 0 ? p.profit / p.qty : 0;
                var unitCost = p.cost;
                var margin = (unitProfit + unitCost) > 0 ? (unitProfit / (unitProfit + unitCost)) * 100 : 0;
                var safeMargin = isNaN(margin) ? 0 : margin.toFixed(0);
                return '<tr>' +
                    '<td class="py-4 px-8 font-bold text-slate-700">' + p.name + '</td>' +
                    '<td class="py-4 px-8 text-center font-medium text-slate-500">' + p.qty + '</td>' +
                    '<td class="py-4 px-8 text-center"><span class="px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded font-bold">' + safeMargin + '%</span></td>' +
                    '<td class="py-4 px-8 text-right font-black text-slate-800">' + formatUSD(p.profit || 0) + '</td>' +
                '</tr>';
            }).join('') : '<tr><td colspan="4" class="py-10 text-center text-slate-400 italic">No hay ventas registradas aún hoy</td></tr>';
        }

        // Charts
        if (window.Charts) {
            window.Charts.renderAnalyticsCharts(currDayProfit);
            if (window._lastCatTotals && window._lastMethodTotals) {
                window.Charts.renderInternalCharts(window._lastCatTotals, window._lastMethodTotals);
            } else {
                var catTotals = {};
                var methodTotals = { 'cash-usd': 0, 'cash-ves': 0, 'card-ves': 0 };
                sales.forEach(function(sale) {
                    methodTotals[sale.method] = (methodTotals[sale.method] || 0) + (Number(sale.totalVES) || 0);
                    if (!Array.isArray(sale.items)) return;
                    sale.items.forEach(function(item) {
                        catTotals[item.category] = (catTotals[item.category] || 0) + ((Number(item.unitPriceVES) || 0) * (Number(item.qty) || 0));
                    });
                });
                window.Charts.renderInternalCharts(catTotals, methodTotals);
            }
        }

        var expensesList = Array.isArray(expenses) ? expenses : [];
        var totalExpensesUSD = expensesList.reduce(function(acc, e) { return acc + (Number(e.amountUSD) || 0); }, 0);
        var avgMarginRate = (isNaN(avgMargin) || avgMargin <= 0) ? 0.3 : (avgMargin / 100);

        var be = calculateBreakEven(totalExpensesUSD, avgMarginRate, daySales);
        var beStatusEl = document.getElementById('ana-be-status');
        var bePercentEl = document.getElementById('ana-be-percent');
        var beBarEl = document.getElementById('ana-be-bar');

        if (beStatusEl) {
            if (totalExpensesUSD === 0) {
                beStatusEl.textContent = 'Registra gastos para calcular el punto de equilibrio';
                beStatusEl.classList.remove('text-emerald-600');
            } else if (daySales >= be.breakEvenSales) {
                beStatusEl.textContent = '\u00a1Meta Alcanzada! (Ganancia neta)';
                beStatusEl.classList.add('text-emerald-600');
            } else {
                beStatusEl.textContent = 'Faltan ' + formatUSD(be.breakEvenSales - daySales) + ' para ser rentable hoy';
                beStatusEl.classList.remove('text-emerald-600');
            }
        }

        var displayPercent = totalExpensesUSD === 0 ? 0 : be.bePercent;
        if (bePercentEl) bePercentEl.textContent = (isNaN(displayPercent) ? 0 : displayPercent).toFixed(0) + '%';
        if (beBarEl) beBarEl.style.width = (isNaN(displayPercent) ? 0 : displayPercent) + '%';

        var alertKey = 'be_alert_' + new Date().toLocaleDateString();
        if (totalExpensesUSD > 0 && daySales >= be.breakEvenSales && !localStorage.getItem(alertKey)) {
            if (typeof window.sendBusinessAlert === 'function') {
                window.sendBusinessAlert('💰 *META ALCANZADA*: Hoy has superado el punto de equilibrio administrativo.\n*Ventas*: ' + formatUSD(daySales) + '\n*Status*: Operando en ganancia neta.');
                localStorage.setItem(alertKey, 'sent');
            }
        }

        var daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
        var currentDay = new Date().getDate();
        var history7 = dailyHistory.slice(-7);

        var totalRecentSales = history7.reduce(function(acc, d) { return acc + (Number(d.salesUSD) || 0); }, 0) + daySales;
        var daysCount = history7.length + (daySales > 0 ? 1 : 0) || 1;
        var avgDailySales = totalRecentSales / daysCount;

        var projectedSales = ((isNaN(avgDailySales) ? 0 : avgDailySales) * daysInMonth);
        var projEl = document.getElementById('ana-projection-value');
        if (projEl) projEl.textContent = formatUSD(projectedSales);

        var insightsContainer = document.getElementById('ana-insights-container');
        if (insightsContainer) {
            var insightsHTML = '';

            var prodStats = {};
            sales.forEach(function(s) {
                if (!Array.isArray(s.items)) return;
                s.items.forEach(function(i) {
                    if (!prodStats[i.id]) prodStats[i.id] = { name: i.name };
                });
            });

            var slowMovers = products.filter(function(p) {
                return p.stock > 0 && !prodStats[p.id];
            }).sort(function(a, b) {
                return (b.stock * b.costPrice) - (a.stock * a.costPrice);
            }).slice(0, 2);

            var totalDeadValue = slowMovers.reduce(function(acc, p) { return acc + (p.stock * p.costPrice); }, 0);

            if (slowMovers.length > 0 && totalDeadValue > 0) {
                insightsHTML += '<div class="flex gap-4 animate-fadeIn">' +
                    '<div class="w-10 h-10 shrink-0 bg-rose-500/20 rounded-xl flex items-center justify-center text-rose-400">' +
                    '<i class="fas fa-exclamation-triangle"></i></div>' +
                    '<div><p class="text-xs font-bold text-rose-300 mb-1">Capital Muerto Detectado</p>' +
                    '<p class="text-[10px] text-slate-400 leading-relaxed">Tienes <b>' + formatUSD(totalDeadValue) + '</b> atrapados en stock que no se mueve hoy. ' +
                    'Espec\u00edficamente: ' + slowMovers.map(function(p) { return '<b>' + p.name + '</b> (x' + p.stock + ')'; }).join(' y ') + '.</p></div></div>';
            }

            if (totalExpensesUSD > 0 && currDayProfit > 0) {
                var expenseRatio = (totalExpensesUSD / currDayProfit) * 100;
                if (expenseRatio > 50) {
                    insightsHTML += '<div class="flex gap-4 animate-fadeIn">' +
                        '<div class="w-10 h-10 shrink-0 bg-amber-500/20 rounded-xl flex items-center justify-center text-amber-400">' +
                        '<i class="fas fa-wallet"></i></div>' +
                        '<div><p class="text-xs font-bold text-amber-300 mb-1">Alerta de Gastos</p>' +
                        '<p class="text-[10px] text-slate-400 leading-relaxed">Los gastos de hoy (<b>' + formatUSD(totalExpensesUSD) + '</b>) consumen el <b>' + expenseRatio.toFixed(0) + '%</b> de tu utilidad. ' +
                        'Considera optimizar costos operativos.</p></div></div>';
                }
            }

            if (daySales > avgDailySales * 1.05) {
                var growthDiff = daySales - avgDailySales;
                insightsHTML += '<div class="flex gap-4 animate-fadeIn">' +
                    '<div class="w-10 h-10 shrink-0 bg-emerald-500/20 rounded-xl flex items-center justify-center text-emerald-400">' +
                    '<i class="fas fa-rocket"></i></div>' +
                    '<div><p class="text-xs font-bold text-emerald-300 mb-1">Crecimiento Detectado</p>' +
                    '<p class="text-[10px] text-slate-400 leading-relaxed">\u00a1Gran jornada! Est\u00e1s vendiendo <b>' + formatUSD(growthDiff) + '</b> m\u00e1s que tu promedio diario habitual.</p></div></div>';
            }

            insightsContainer.innerHTML = insightsHTML || '<p class="text-xs text-slate-500 italic text-center">Analizando datos... No hay alertas cr\u00edticas hoy.</p>';
        }

        var replenishEl = document.getElementById('ana-replenish-advice');
        if (replenishEl) {
            var safeReinvest = currDayProfit * 0.7;
            replenishEl.textContent = 'Puedes reinvertir hasta ' + formatUSD(safeReinvest) + ' en mercanc\u00eda manteniendo el flujo de caja estable.';
        }

        var avgDailyItemsCost = history7.length ? history7.reduce(function(acc, d) { return acc + (d.salesUSD - (d.profitUSD || 0)); }, 0) / history7.length : (daySales * 0.7);
        var runwayDays = inventoryValue / (avgDailyItemsCost || 1);
        var runwayEl = document.getElementById('ana-inventory-runway');
        if (runwayEl) {
            runwayEl.textContent = runwayDays.toFixed(0) + ' d\u00edas de stock';
            if (runwayDays < 5) {
                runwayEl.className = 'px-2 py-0.5 bg-rose-50 text-rose-700 text-[10px] font-black rounded-lg border border-rose-100 animate-pulse';
            } else {
                runwayEl.className = 'px-2 py-0.5 bg-brand-50 text-brand-700 text-[10px] font-black rounded-lg border border-brand-100';
            }
        }

        var lastSnapshot = dailyHistory[dailyHistory.length - 1];
        var resEl = document.getElementById('ana-rate-resilience');
        if (resEl && lastSnapshot) {
            var rateDiff = (settings.exchangeRate || 0) - (lastSnapshot.exchangeRate || settings.exchangeRate || 0);
            resEl.classList.remove('hidden');
            if (rateDiff > 0.5) {
                resEl.textContent = 'ALERTA TASA';
                resEl.className = 'text-[9px] font-black uppercase tracking-tighter px-1.5 py-0.5 rounded-md border bg-rose-500 text-white border-rose-600 animate-bounce';
                if (insightsContainer) {
                    var lossPercent = (rateDiff / (settings.exchangeRate || 1)) * 100;
                    insightsContainer.innerHTML += '<div class="flex gap-4 animate-fadeIn">' +
                        '<div class="w-10 h-10 shrink-0 bg-rose-500/10 rounded-xl flex items-center justify-center text-rose-500">' +
                        '<i class="fas fa-chart-line"></i></div>' +
                        '<div><p class="text-xs font-bold text-rose-300 mb-1">Riesgo de Reposici\u00f3n</p>' +
                        '<p class="text-[10px] text-slate-400 leading-relaxed">La tasa subi\u00f3 un ' + lossPercent.toFixed(1) + '%. Tu utilidad real es menor a la nominal. Revisa precios de costo.</p></div></div>';
                }
            } else {
                resEl.textContent = 'TASA ESTABLE';
                resEl.className = 'text-[9px] font-black uppercase tracking-tighter px-1.5 py-0.5 rounded-md border bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
            }
        }

        if (runwayDays < 3 && insightsContainer) {
            insightsContainer.innerHTML += '<div class="flex gap-4 animate-fadeIn">' +
                '<div class="w-10 h-10 shrink-0 bg-brand-500/20 rounded-xl flex items-center justify-center text-brand-400">' +
                '<i class="fas fa-truck-loading"></i></div>' +
                '<div><p class="text-xs font-bold text-brand-300 mb-1">Reabastecimiento Cr\u00edtico</p>' +
                '<p class="text-[10px] text-slate-400 leading-relaxed">Tu inventario se agotar\u00e1 en menos de 3 d\u00edas al ritmo actual de ventas.</p></div></div>';
        }
    }

    return {
        renderAnalytics: renderAnalytics,
        calculateInventoryValue: calculateInventoryValue,
        calculateDayProfit: calculateDayProfit,
        calculateBreakEven: calculateBreakEven,
        calculateProductRanking: calculateProductRanking,
        formatUSD: formatUSD
    };
})();
