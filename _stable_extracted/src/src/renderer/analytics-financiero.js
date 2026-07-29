/**
 * FinancialAnalytics — Módulo de Rendimiento, Costos y Rentabilidad
 *
 * Funciones analíticas avanzadas para el POS Caja Fresh.
 * Diseñado para funcionar con las estructuras globales existentes (sales, products, dailyHistory, expenses, settings).
 *
 * Modo de uso desde app.js:
 *   <script src="src/renderer/analytics-financiero.js"></script>
 *   FinancialAnalytics.calculateABCDistribution(sales, products);
 *   FinancialAnalytics.generateDailyReportJSON(sales, products, expenses, dailyHistory, settings);
 */

window.FinancialAnalytics = (function() {

    // ──────────────────────────────────────────────
    // 1. VENTA NETA (REAL)
    // ──────────────────────────────────────────────

    /**
     * Calcula Venta Neta: Bruta - Devoluciones - Anulaciones - Costo de Mermas
     * @param {Array} sales       - Arreglo global de ventas
     * @param {Array} shrinkages  - Arreglo de mermas (opcional, por defecto [])
     * @returns {{ grossSales: number, returnsTotal: number, voidsTotal: number, netSales: number, shrinkageCost: number, realRevenue: number }}
     */
    function calculateNetSales(sales, shrinkages) {
        shrinkages = shrinkages || getShrinkageRecords();

        const grossSales = sales.reduce((sum, s) => sum + (Number(s.totalUSD) || 0), 0);
        const returnsTotal = sales
            .filter(s => s.status === 'returned')
            .reduce((sum, s) => sum + (Number(s.totalUSD) || 0), 0);
        const voidsTotal = sales
            .filter(s => s.status === 'voided' || s.status === 'void')
            .reduce((sum, s) => sum + (Number(s.totalUSD) || 0), 0);
        const shrinkageCost = shrinkages.reduce((sum, sh) => sum + (Number(sh.totalCost) || 0), 0);
        const netSales = grossSales - returnsTotal - voidsTotal;

        return {
            grossSales: round(grossSales),
            returnsTotal: round(returnsTotal),
            voidsTotal: round(voidsTotal),
            netSales: round(netSales),
            shrinkageCost: round(shrinkageCost),
            realRevenue: round(netSales - shrinkageCost)
        };
    }

    // ──────────────────────────────────────────────
    // 2. COGS y MÉTRICAS DE COSTO
    // ──────────────────────────────────────────────

    /**
     * Calcula COGS (Costo de los Productos Vendidos) con ajuste por mermas
     * @param {Array} sales
     * @param {Array} shrinkages
     * @returns {{ directCOGS: number, shrinkageAdjustment: number, totalCOGS: number, cogsPctOfSales: number }}
     */
    function calculateCOGS(sales, shrinkages) {
        shrinkages = shrinkages || getShrinkageRecords();

        const directCOGS = sales
            .filter(s => s.status === 'completed' || s.status === 'paid')
            .reduce((sum, s) => sum + (Number(s.totalCostUSD) || 0), 0);

        const shrinkageAdjustment = shrinkages.reduce((sum, sh) => sum + (Number(sh.totalCost) || 0), 0);
        const totalCOGS = directCOGS + shrinkageAdjustment;

        const grossSales = sales.reduce((sum, s) => sum + (Number(s.totalUSD) || 0), 0);
        const cogsPctOfSales = grossSales > 0 ? (totalCOGS / grossSales) * 100 : 0;

        return {
            directCOGS: round(directCOGS),
            shrinkageAdjustment: round(shrinkageAdjustment),
            totalCOGS: round(totalCOGS),
            cogsPctOfSales: round(cogsPctOfSales)
        };
    }

    /**
     * Calcula Margen Bruto y Neto
     * @param {Array} sales
     * @param {Array} expenses
     * @param {Array} shrinkages
     * @returns {{ grossProfit: number, grossMarginPct: number, netProfit: number, netMarginPct: number, rawGrossProfit: number }}
     */
    function calculateMargins(sales, expenses, shrinkages) {
        const net = calculateNetSales(sales, shrinkages);
        const cogs = calculateCOGS(sales, shrinkages);

        const grossProfit = net.realRevenue - cogs.totalCOGS;
        const totalExpenses = (expenses || []).reduce((sum, e) => sum + (Number(e.amountUSD) || 0), 0);
        const netProfit = grossProfit - totalExpenses;

        return {
            grossProfit: round(Math.max(0, grossProfit)),
            rawGrossProfit: round(grossProfit),
            grossMarginPct: net.realRevenue > 0 ? round((Math.max(0, grossProfit) / net.realRevenue) * 100) : 0,
            netProfit: round(Math.max(0, netProfit)),
            netMarginPct: net.realRevenue > 0 ? round((Math.max(0, netProfit) / net.realRevenue) * 100) : 0
        };
    }

    // ──────────────────────────────────────────────
    // 3. GMROI (Gross Margin Return on Inventory)
    // ──────────────────────────────────────────────

    /**
     * GMROI = Gross Profit / Average Inventory Cost
     * @param {Array} products
     * @param {Array} sales
     * @param {Array} dailyHistory
     * @returns {{ gmroi: number, interpretation: string, avgInventoryCost: number }}
     */
    function calculateGMROI(products, sales, dailyHistory) {
        const cogs = calculateCOGS(sales);
        const margins = calculateMargins(sales);

        const currentInventoryCost = products.reduce((sum, p) => {
            return sum + ((Number(p.stock) || 0) * (Number(p.costPrice) || 0));
        }, 0);

        const prevDayHistory = dailyHistory.slice(-1);
        let prevInventoryCost = currentInventoryCost;
        if (prevDayHistory.length > 0) {
            const dayCOGS = prevDayHistory[0].salesUSD - (prevDayHistory[0].profitUSD || 0);
            prevInventoryCost = currentInventoryCost + dayCOGS;
        }

        const avgInventoryCost = (prevInventoryCost + currentInventoryCost) / 2;
        const gmroi = avgInventoryCost > 0 ? margins.grossProfit / avgInventoryCost : 0;

        let interpretation;
        if (gmroi >= 3) interpretation = 'Excelente: cada $1 invertido genera más de $3 de ganancia';
        else if (gmroi >= 1.5) interpretation = 'Buena: retorno saludable sobre inventario';
        else if (gmroi >= 1) interpretation = 'Aceptable: apenas cubres el costo del inventario';
        else interpretation = 'Malo: el inventario cuesta más de lo que genera';

        return {
            gmroi: round(gmroi),
            interpretation: interpretation,
            avgInventoryCost: round(avgInventoryCost)
        };
    }

    // ──────────────────────────────────────────────
    // 4. ROTACIÓN DE INVENTARIO
    // ──────────────────────────────────────────────

    /**
     * Inventario Turnover = COGS / Average Inventory Cost
     * @param {Array} products
     * @param {Array} sales
     * @param {Array} dailyHistory
     * @returns {{ turnover: number, avgInventoryCost: number, daysToSell: number }}
     */
    function calculateInventoryTurnover(products, sales, dailyHistory) {
        const cogs = calculateCOGS(sales);

        const currentInventoryCost = products.reduce((sum, p) => {
            return sum + ((Number(p.stock) || 0) * (Number(p.costPrice) || 0));
        }, 0);

        const prevDayHist = dailyHistory.slice(-1);
        let prevInvCost = currentInventoryCost;
        if (prevDayHist.length > 0) {
            const dayCOGS = prevDayHist[0].salesUSD - (prevDayHist[0].profitUSD || 0);
            prevInvCost = currentInventoryCost + dayCOGS;
        }

        const avgInventoryCost = (prevInvCost + currentInventoryCost) / 2;
        const turnover = avgInventoryCost > 0 ? cogs.totalCOGS / avgInventoryCost : 0;

        const daysInPeriod = sales.length > 0 ? 1 : 1;
        const daysToSell = turnover > 0 ? daysInPeriod / turnover : 0;

        return {
            turnover: round(turnover),
            avgInventoryCost: round(avgInventoryCost),
            daysToSell: round(daysToSell)
        };
    }

    // ──────────────────────────────────────────────
    // 5. ANÁLISIS ABC (PARETO)
    // ──────────────────────────────────────────────

    /**
     * Clasifica productos según contribución a la ganancia (Pareto).
     * A: 0-80%, B: 80-95%, C: 95-100%
     * @param {Array} sales
     * @param {Array} products
     * @returns {{ A: Array, B: Array, C: Array, summary: { aCount: number, aProfitPct: number, bCount: number, bProfitPct: number, cCount: number, cProfitPct: number }, all: Array }}
     */
    function calculateABCDistribution(sales, products) {
        const productProfitMap = {};

        sales.forEach(sale => {
            if (sale.status === 'voided' || sale.status === 'void' || !Array.isArray(sale.items)) return;
            sale.items.forEach(item => {
                const prodId = item.id || item.productId;
                if (!prodId) return;

                if (!productProfitMap[prodId]) {
                    const prod = products.find(p => p.id === prodId || p.id === item.parentId);
                    productProfitMap[prodId] = {
                        productId: prodId,
                        name: prod?.name || item.name || 'Sin nombre',
                        category: prod?.category || item.category || 'Sin Categoría',
                        totalQty: 0,
                        totalRevenue: 0,
                        totalCost: 0,
                        totalProfit: 0
                    };
                }

                const rec = productProfitMap[prodId];
                const qty = Number(item.qty) || 0;
                const itemRevenue = (Number(item.unitPriceUSD) || Number(item.price) || 0) * qty;
                const unitCost = Number(item.costPrice) || 0;
                const itemCost = unitCost * qty;

                rec.totalQty += qty;
                rec.totalRevenue += itemRevenue;
                rec.totalCost += itemCost;
                rec.totalProfit += (itemRevenue - itemCost);
            });
        });

        const ranked = Object.values(productProfitMap)
            .sort((a, b) => b.totalProfit - a.totalProfit);

        const totalProfit = ranked.reduce((sum, r) => sum + Math.max(0, r.totalProfit), 0);

        if (totalProfit === 0) {
            return {
                A: [], B: [], C: [],
                summary: { aCount: 0, aProfitPct: 0, bCount: 0, bProfitPct: 0, cCount: 0, cProfitPct: 0 },
                all: ranked
            };
        }

        let cumulative = 0;
        const classified = ranked.map(r => {
            const pct = totalProfit > 0 ? (Math.max(0, r.totalProfit) / totalProfit) * 100 : 0;
            cumulative += pct;
            const margin = (r.totalRevenue > 0) ? (Math.max(0, r.totalProfit) / r.totalRevenue) * 100 : 0;

            let cls, action;
            if (cumulative <= 80) {
                cls = 'A';
                action = 'Mantener stock optimizado. Priorizar reposición automática.';
            } else if (cumulative <= 95) {
                cls = 'B';
                action = 'Evaluar rotación. Monitorear margen semanalmente.';
            } else {
                cls = 'C';
                action = 'Considerar descontinuar o liquidar si no mejora en 30 días.';
            }

            return {
                ...r,
                totalRevenue: round(r.totalRevenue),
                totalCost: round(r.totalCost),
                totalProfit: round(r.totalProfit),
                profitPct: round(pct),
                cumulativePct: round(cumulative),
                marginPct: round(margin),
                class: cls,
                action: action
            };
        });

        const A = classified.filter(r => r.class === 'A');
        const B = classified.filter(r => r.class === 'B');
        const C = classified.filter(r => r.class === 'C');

        const aProfitPct = A.reduce((sum, r) => sum + r.profitPct, 0);
        const bProfitPct = B.reduce((sum, r) => sum + r.profitPct, 0);
        const cProfitPct = C.reduce((sum, r) => sum + r.profitPct, 0);

        return {
            A, B, C,
            summary: {
                aCount: A.length, aProfitPct: round(aProfitPct),
                bCount: B.length, bProfitPct: round(bProfitPct),
                cCount: C.length, cProfitPct: round(cProfitPct)
            },
            all: classified
        };
    }

    // ──────────────────────────────────────────────
    // 6. MATRIZ VOLUMEN vs MARGEN (BCG)
    // ──────────────────────────────────────────────

    /**
     * Matriz de 4 cuadrantes: Estrella, Vaca Lechera, Perro, Interrogante
     * @param {Array} sales
     * @param {Array} products
     * @returns {{ stars: Array, cashCows: Array, dogs: Array, questionMarks: Array, summary: Object }}
     */
    function calculateBCGMatrix(sales, products) {
        const productStats = {};

        sales.forEach(sale => {
            if (sale.status === 'voided' || sale.status === 'void' || !Array.isArray(sale.items)) return;
            sale.items.forEach(item => {
                const prodId = item.id || item.productId;
                if (!prodId) return;
                if (!productStats[prodId]) {
                    const prod = products.find(p => p.id === prodId || p.id === item.parentId);
                    productStats[prodId] = {
                        productId: prodId,
                        name: prod?.name || item.name || 'Sin nombre',
                        qty: 0,
                        totalRevenue: 0,
                        totalCost: 0,
                        totalProfit: 0
                    };
                }
                const qty = Number(item.qty) || 0;
                const revenue = (Number(item.unitPriceUSD) || Number(item.price) || 0) * qty;
                const cost = (Number(item.costPrice) || 0) * qty;
                productStats[prodId].qty += qty;
                productStats[prodId].totalRevenue += revenue;
                productStats[prodId].totalCost += cost;
                productStats[prodId].totalProfit += (revenue - cost);
            });
        });

        const entries = Object.values(productStats);
        if (entries.length === 0) {
            return { stars: [], cashCows: [], dogs: [], questionMarks: [], summary: null };
        }

        const qtyValues = entries.map(e => e.qty);
        const qtySorted = [...qtyValues].sort((a, b) => a - b);
        const medianQty = qtySorted.length % 2 === 0
            ? (qtySorted[qtySorted.length / 2 - 1] + qtySorted[qtySorted.length / 2]) / 2
            : qtySorted[Math.floor(qtySorted.length / 2)];

        const MARGIN_THRESHOLD = 20;

        const matrix = { stars: [], cashCows: [], dogs: [], questionMarks: [] };

        entries.forEach(e => {
            const marginPct = e.totalRevenue > 0 ? (Math.max(0, e.totalProfit) / e.totalRevenue) * 100 : 0;
            const highVolume = e.qty >= medianQty;
            const highMargin = marginPct >= MARGIN_THRESHOLD;

            let quadrant;
            if (highVolume && highMargin) quadrant = 'stars';
            else if (highVolume && !highMargin) quadrant = 'cashCows';
            else if (!highVolume && !highMargin) quadrant = 'dogs';
            else quadrant = 'questionMarks';

            matrix[quadrant].push({
                productId: e.productId,
                name: e.name,
                qty: e.qty,
                totalRevenue: round(e.totalRevenue),
                totalProfit: round(e.totalProfit),
                marginPct: round(marginPct),
                quadrant: quadrant
            });
        });

        const summary = {
            starCount: matrix.stars.length,
            starProfit: round(matrix.stars.reduce((s, p) => s + p.totalProfit, 0)),
            cashCowCount: matrix.cashCows.length,
            cashCowProfit: round(matrix.cashCows.reduce((s, p) => s + p.totalProfit, 0)),
            dogCount: matrix.dogs.length,
            dogProfit: round(matrix.dogs.reduce((s, p) => s + p.totalProfit, 0)),
            questionCount: matrix.questionMarks.length,
            questionProfit: round(matrix.questionMarks.reduce((s, p) => s + p.totalProfit, 0)),
            recommendations: {
                stars: 'Maximizar visibilidad y disponibilidad. Son el motor de ganancias.',
                cashCows: 'Mantener inventario just-in-time. Rotación estable, márgenes ajustados.',
                dogs: 'Revisar costos. Si no mejora margen en 30 días, considerar descontinuar.',
                questionMarks: 'Buen margen pero bajo volumen. Aumentar exposición o evaluar precio.'
            }
        };

        return { ...matrix, summary };
    }

    // ──────────────────────────────────────────────
    // 7. TENDENCIA DE COSTOS POR PROVEEDOR
    // ──────────────────────────────────────────────

    /**
     * Analiza variación de costos vs el historial de dailyHistory
     * y emite alertas cuando el margen se reduce significativamente.
     * @param {Array} sales
     * @param {Array} products
     * @param {Array} dailyHistory
     * @param {Object} settings
     * @returns {{ alerts: Array, stable: Array, summary: Object }}
     */
    function calculateCostTrends(sales, products, dailyHistory, settings) {
        const exchangeRate = Number(settings?.exchangeRate) || 1;

        const productCostMap = {};
        products.forEach(p => {
            productCostMap[p.id] = {
                name: p.name,
                currentCost: Number(p.costPrice) || 0,
                category: p.category || 'Sin Categoría',
                stock: Number(p.stock) || 0
            };
        });

        const productProfitMap = {};
        sales.forEach(sale => {
            if (!Array.isArray(sale.items)) return;
            sale.items.forEach(item => {
                const prodId = item.id || item.productId;
                if (!prodId || !productCostMap[prodId]) return;
                if (!productProfitMap[prodId]) {
                    productProfitMap[prodId] = { revenue: 0, cost: 0, qty: 0 };
                }
                const qty = Number(item.qty) || 0;
                const revenue = (Number(item.unitPriceUSD) || Number(item.price) || 0) * qty;
                const cost = (Number(item.costPrice) || 0) * qty;
                productProfitMap[prodId].revenue += revenue;
                productProfitMap[prodId].cost += cost;
                productProfitMap[prodId].qty += qty;
            });
        });

        const alerts = [];
        const stable = [];

        const costHistory = localStorage.getItem('freshpos_cost_history');
        const parsedHistory = costHistory ? safeJSONParse(costHistory) : {};

        products.forEach(p => {
            if (!p.costPrice) return;
            const previous = parsedHistory[p.id];
            if (!previous) return;

            const currentCost = Number(p.costPrice) || 0;
            const previousCost = Number(previous.cost) || currentCost;
            const variationPct = previousCost > 0 ? ((currentCost - previousCost) / previousCost) * 100 : 0;

            const stats = productProfitMap[p.id];
            const revenue = stats ? stats.revenue : 0;
            const cost = stats ? stats.cost : 0;
            const salePrice = revenue > 0 && stats.qty > 0 ? revenue / stats.qty : 0;
            const prevMargin = salePrice > 0 ? ((salePrice - previousCost) / salePrice) * 100 : 0;
            const currMargin = salePrice > 0 ? ((salePrice - currentCost) / salePrice) * 100 : 0;
            const impactOnMargin = currMargin - prevMargin;

            if (Math.abs(variationPct) > 5) {
                let severity;
                let recommendation;
                if (variationPct <= 10) {
                    severity = 'low';
                    recommendation = 'Sin acción urgente. Monitorear próximo pedido.';
                } else if (variationPct <= 25) {
                    severity = 'medium';
                    const priceAdjust = (currentCost - previousCost) / previousCost * 100;
                    recommendation = `Considere aumentar precio de venta ~${Math.ceil(priceAdjust)}% para mantener margen.`;
                } else {
                    severity = 'high';
                    recommendation = 'Reevalúe proveedor o busque sustituto. Margen en riesgo crítico.';
                }

                if (variationPct > 0) {
                    alerts.push({
                        productId: p.id,
                        productName: p.name,
                        category: p.category,
                        previousCost: round(previousCost),
                        currentCost: round(currentCost),
                        variationPct: round(variationPct),
                        impactOnMargin: round(impactOnMargin),
                        severity,
                        recommendation,
                        supplier: previous.supplier || 'No registrado'
                    });
                } else {
                    stable.push({
                        productId: p.id,
                        productName: p.name,
                        variationPct: round(variationPct),
                        note: 'Costo redujo. Margen mejoró.'
                    });
                }
            }
        });

        return {
            alerts: alerts.sort((a, b) => b.variationPct - a.variationPct),
            stable,
            summary: {
                totalAnalyzed: products.filter(p => p.costPrice).length,
                alertsCount: alerts.length,
                criticalAlerts: alerts.filter(a => a.severity === 'high').length,
                mediumAlerts: alerts.filter(a => a.severity === 'medium').length
            }
        };
    }

    /**
     * Guarda un snapshot de costos actuales para futuras comparaciones.
     * Debe llamarse después de cada compra/actualización de costos.
     * @param {Array} products
     * @param {string} supplier
     */
    function saveCostSnapshot(products, supplier) {
        const key = 'freshpos_cost_history';
        const existing = localStorage.getItem(key);
        const history = existing ? safeJSONParse(existing) : {};

        products.forEach(p => {
            if (!p.costPrice) return;
            history[p.id] = {
                cost: Number(p.costPrice),
                supplier: supplier || 'Manual',
                date: new Date().toISOString()
            };
        });

        localStorage.setItem(key, JSON.stringify(history));
    }

    // ──────────────────────────────────────────────
    // 8. MERMAS (SHRINKAGE)
    // ──────────────────────────────────────────────

    const SHRINKAGE_STORAGE_KEY = 'freshpos_shrinkages';

    /**
     * Registra una merma/pérdida de inventario
     * @param {Object} data - { productId, productName, quantity, unitCost, type, description, registeredBy }
     * @returns {Array} registro actualizado de mermas
     */
    function recordShrinkage(data) {
        const records = getShrinkageRecords();
        const entry = {
            id: 'shr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            date: new Date().toISOString(),
            productId: data.productId,
            productName: data.productName || 'Desconocido',
            quantity: Number(data.quantity) || 0,
            unitCost: Number(data.unitCost) || 0,
            totalCost: (Number(data.quantity) || 0) * (Number(data.unitCost) || 0),
            type: data.type || 'damage',
            description: data.description || '',
            registeredBy: data.registeredBy || 'sistema'
        };
        records.push(entry);
        localStorage.setItem(SHRINKAGE_STORAGE_KEY, JSON.stringify(records));
        return records;
    }

    function getShrinkageRecords() {
        const raw = localStorage.getItem(SHRINKAGE_STORAGE_KEY);
        return raw ? safeJSONParse(raw) : [];
    }

    function clearShrinkageRecords() {
        localStorage.removeItem(SHRINKAGE_STORAGE_KEY);
    }

    // ──────────────────────────────────────────────
    // 9. REPORTE JSON COMPLETO DEL DÍA
    // ──────────────────────────────────────────────

    /**
     * Genera el objeto JSON completo con todos los indicadores financieros del día.
     * @param {Array} sales
     * @param {Array} products
     * @param {Array} expenses
     * @param {Array} dailyHistory
     * @param {Object} settings
     * @returns {Object} reporte financiero completo
     */
    function generateDailyReportJSON(sales, products, expenses, dailyHistory, settings) {
        const today = new Date().toISOString().slice(0, 10);
        const daySales = sales.filter(s => {
            const sDate = s.date ? s.date.slice(0, 10) : '';
            return sDate === today;
        });

        const shrinkages = getShrinkageRecords();

        // KPIs base
        const netSales = calculateNetSales(daySales, shrinkages);
        const cogs = calculateCOGS(daySales, shrinkages);
        const margins = calculateMargins(daySales, expenses, shrinkages);
        const gmroi = calculateGMROI(products, daySales, dailyHistory);
        const turnover = calculateInventoryTurnover(products, daySales, dailyHistory);
        const abc = calculateABCDistribution(daySales, products);
        const bcg = calculateBCGMatrix(daySales, products);

        // Tickets
        const completedSales = daySales.filter(s => s.status === 'completed' || s.status === 'paid');
        const totalTickets = completedSales.length;
        const avgTicket = totalTickets > 0 ? netSales.netSales / totalTickets : 0;
        const totalItems = completedSales.reduce((sum, s) => {
            return sum + (Array.isArray(s.items) ? s.items.reduce((a, i) => a + (Number(i.qty) || 0), 0) : 0);
        }, 0);
        const avgItemsPerTicket = totalTickets > 0 ? totalItems / totalTickets : 0;

        // Desglose de gastos
        const expenseBreakdown = {};
        (expenses || []).forEach(e => {
            const cat = e.category || 'Otros';
            expenseBreakdown[cat] = (expenseBreakdown[cat] || 0) + (Number(e.amountUSD) || 0);
        });

        // Inventario
        const inventoryCost = products.reduce((sum, p) => {
            return sum + ((Number(p.stock) || 0) * (Number(p.costPrice) || 0));
        }, 0);

        // Comparativa histórica
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().slice(0, 10);
        const yesterdayEntry = dailyHistory.find(d => d.date && d.date.slice(0, 10) === yesterdayStr);

        const last7 = dailyHistory.slice(-7);
        const last7AvgSales = last7.length > 0 ? last7.reduce((sum, d) => sum + (Number(d.salesUSD) || 0), 0) / last7.length : 0;
        const last7AvgProfit = last7.length > 0 ? last7.reduce((sum, d) => sum + (Number(d.profitUSD) || 0), 0) / last7.length : 0;

        const todaySales = netSales.grossSales;
        const todayProfit = margins.grossProfit;

        const vsYesterday = yesterdayEntry ? {
            salesVarPct: yesterdayEntry.salesUSD > 0 ? round(((todaySales - yesterdayEntry.salesUSD) / yesterdayEntry.salesUSD) * 100) : 0,
            profitVarPct: (yesterdayEntry.profitUSD || 0) > 0 ? round(((todayProfit - (yesterdayEntry.profitUSD || 0)) / (yesterdayEntry.profitUSD || 0)) * 100) : 0
        } : null;

        const vsTrend = {
            salesVarPct: last7AvgSales > 0 ? round(((todaySales - last7AvgSales) / last7AvgSales) * 100) : 0,
            profitVarPct: last7AvgProfit > 0 ? round(((todayProfit - last7AvgProfit) / last7AvgProfit) * 100) : 0,
            direction: todayProfit >= last7AvgProfit ? 'positive' : 'negative'
        };

        // Cost Trends
        const costTrends = calculateCostTrends(daySales, products, dailyHistory, settings);

        // Punto de equilibrio del día
        const totalExpensesUSD = (expenses || []).reduce((sum, e) => sum + (Number(e.amountUSD) || 0), 0);
        const avgMarginRate = margins.grossMarginPct > 0 ? margins.grossMarginPct / 100 : 0.01;
        const breakEvenSales = avgMarginRate > 0 ? totalExpensesUSD / avgMarginRate : 0;

        return {
            metadata: {
                reportDate: today,
                generatedAt: new Date().toISOString(),
                period: {
                    type: 'daily',
                    start: today + 'T00:00:00.000Z',
                    end: today + 'T23:59:59.000Z'
                },
                valuationMethod: 'weighted_average',
                currency: 'USD',
                exchangeRate: settings?.exchangeRate || 1
            },

            summary: {
                grossSales: netSales.grossSales,
                returns: netSales.returnsTotal,
                voids: netSales.voidsTotal,
                netSales: netSales.netSales,
                shrinkageCost: netSales.shrinkageCost,
                realRevenue: netSales.realRevenue,

                cogs: {
                    direct: cogs.directCOGS,
                    shrinkageAdjustment: cogs.shrinkageAdjustment,
                    total: cogs.totalCOGS,
                    pctOfSales: cogs.cogsPctOfSales
                },

                grossProfit: {
                    amount: margins.grossProfit,
                    rawAmount: margins.rawGrossProfit,
                    marginPct: margins.grossMarginPct
                },

                operatingExpenses: {
                    total: totalExpensesUSD,
                    breakdown: expenseBreakdown
                },

                netProfit: {
                    amount: margins.netProfit,
                    marginPct: margins.netMarginPct
                },

                tickets: {
                    total: daySales.length,
                    completed: totalTickets,
                    avgTicket: round(avgTicket),
                    avgItemsPerTicket: round(avgItemsPerTicket),
                    avgProfitPerTicket: totalTickets > 0 ? round(margins.grossProfit / totalTickets) : 0
                },

                breakEven: {
                    requiredSales: round(breakEvenSales),
                    currentSales: round(netSales.netSales),
                    progressPct: breakEvenSales > 0 ? round(Math.min(100, (netSales.netSales / breakEvenSales) * 100)) : 100,
                    status: netSales.netSales >= breakEvenSales ? 'surpassed' : 'pending'
                },

                inventory: {
                    totalCost: round(inventoryCost),
                    stockValueAtRetail: round(products.reduce((sum, p) => {
                        const price = Number(p.priceUSD) || Number(p.price) || 0;
                        return sum + ((Number(p.stock) || 0) * price);
                    }, 0)),
                    runwayDays: round(turnover.daysToSell),
                    turnover: turnover.turnover,
                    avgMarginOnInventory: margins.grossMarginPct
                },

                gmroi: {
                    value: gmroi.gmroi,
                    interpretation: gmroi.interpretation,
                    avgInventoryCost: gmroi.avgInventoryCost
                }
            },

            abcAnalysis: {
                classA: { count: abc.summary.aCount, profitPct: abc.summary.aProfitPct, products: abc.A },
                classB: { count: abc.summary.bCount, profitPct: abc.summary.bProfitPct, products: abc.B },
                classC: { count: abc.summary.cCount, profitPct: abc.summary.cProfitPct, products: abc.C }
            },

            matrixVolumeMargin: {
                stars: { ...bcg.summary ? {
                    quadrant: 'star',
                    count: bcg.summary.starCount,
                    totalProfit: bcg.summary.starProfit,
                    recommendation: bcg.summary.recommendations.stars,
                    products: bcg.stars
                } : { quadrant: 'star', count: 0, totalProfit: 0, products: [] } },
                cashCows: { ...bcg.summary ? {
                    quadrant: 'cash_cow',
                    count: bcg.summary.cashCowCount,
                    totalProfit: bcg.summary.cashCowProfit,
                    recommendation: bcg.summary.recommendations.cashCows,
                    products: bcg.cashCows
                } : { quadrant: 'cash_cow', count: 0, totalProfit: 0, products: [] } },
                dogs: { ...bcg.summary ? {
                    quadrant: 'dog',
                    count: bcg.summary.dogCount,
                    totalProfit: bcg.summary.dogProfit,
                    recommendation: bcg.summary.recommendations.dogs,
                    products: bcg.dogs
                } : { quadrant: 'dog', count: 0, totalProfit: 0, products: [] } },
                questionMarks: { ...bcg.summary ? {
                    quadrant: 'question_mark',
                    count: bcg.summary.questionCount,
                    totalProfit: bcg.summary.questionProfit,
                    recommendation: bcg.summary.recommendations.questionMarks,
                    products: bcg.questionMarks
                } : { quadrant: 'question_mark', count: 0, totalProfit: 0, products: [] } }
            },

            costTrends: {
                alerts: costTrends.alerts,
                stableSuppliers: costTrends.stable,
                summary: costTrends.summary
            },

            dailyHistoryComparison: {
                yesterday: yesterdayEntry ? {
                    netSales: yesterdayEntry.salesUSD,
                    grossProfit: yesterdayEntry.profitUSD,
                    expenses: yesterdayEntry.expensesUSD
                } : null,
                last7Avg: {
                    netSales: round(last7AvgSales),
                    grossProfit: round(last7AvgProfit)
                },
                vsYesterday: vsYesterday,
                vsTrend: vsTrend
            }
        };
    }

    /**
     * Descarga el reporte JSON como archivo .json
     */
    function downloadDailyReportJSON(sales, products, expenses, dailyHistory, settings) {
        const report = generateDailyReportJSON(sales, products, expenses, dailyHistory, settings);
        const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `reporte-financiero-${report.metadata.reportDate}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    // ──────────────────────────────────────────────
    // 10. MÉTRICAS DE TICKET
    // ──────────────────────────────────────────────

    /**
     * Calcula ticket promedio, costo por ticket, profit por ticket
     * @param {Array} sales
     * @returns {{ avgTicket: number, avgCostPerTicket: number, avgProfitPerTicket: number, totalTickets: number }}
     */
    function calculateTicketMetrics(sales) {
        const completed = sales.filter(s => s.status === 'completed' || s.status === 'paid');
        const total = completed.length;

        if (total === 0) return { avgTicket: 0, avgCostPerTicket: 0, avgProfitPerTicket: 0, totalTickets: 0 };

        const totalSales = completed.reduce((sum, s) => sum + (Number(s.totalUSD) || 0), 0);
        const totalCost = completed.reduce((sum, s) => sum + (Number(s.totalCostUSD) || 0), 0);

        return {
            avgTicket: round(totalSales / total),
            avgCostPerTicket: round(totalCost / total),
            avgProfitPerTicket: round((totalSales - totalCost) / total),
            totalTickets: total
        };
    }

    // ──────────────────────────────────────────────
    // HELPERS
    // ──────────────────────────────────────────────

    function round(n) {
        return Math.round((n + Number.EPSILON) * 100) / 100;
    }

    function safeJSONParse(str) {
        try { return JSON.parse(str); } catch (e) { return {}; }
    }

    // ──────────────────────────────────────────────
    // API PÚBLICA
    // ──────────────────────────────────────────────

    return {
        calculateNetSales,
        calculateCOGS,
        calculateMargins,
        calculateGMROI,
        calculateInventoryTurnover,
        calculateABCDistribution,
        calculateBCGMatrix,
        calculateCostTrends,
        calculateTicketMetrics,
        generateDailyReportJSON,
        downloadDailyReportJSON,

        // Mermas
        recordShrinkage,
        getShrinkageRecords,
        clearShrinkageRecords,

        // Costos
        saveCostSnapshot
    };

})();
