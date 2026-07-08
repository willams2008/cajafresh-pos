/**
 * Charts Module
 * Renderizado de gráficas de Analytics e Internas.
 */

window.Charts = (function() {
    let chartCategory = null;
    let chartPayment = null;
    let anaTrendChart = null;
    let anaEfficiencyChart = null;

    function renderAnalyticsCharts(dayProfitToday) {
        const canvasTrend = document.getElementById('ana-chart-trend');
        const canvasEff = document.getElementById('ana-chart-efficiency');
        if (!canvasTrend || !canvasEff) return;

        const ctxTrend = canvasTrend.getContext('2d');
        const ctxEff = canvasEff.getContext('2d');

        if (anaTrendChart) anaTrendChart.destroy();
        if (anaEfficiencyChart) anaEfficiencyChart.destroy();

        // Data para tendencia (últimos 6 registros de historia + hoy)
        const historyLast = (window.dailyHistory || []).slice(-6);
        const labels = historyLast.map(d => new Date(d.date).toLocaleDateString('es-VE', {day:'2-digit', month:'short'}));
        labels.push('Hoy');

        const salesData = historyLast.map(d => d.salesUSD);
        const currentSales = (window.sales || []).reduce((acc, s) => acc + (Number(s.totalUSD) || 0), 0);
        salesData.push(currentSales);

        const profitData = historyLast.map(d => d.profitUSD);
        profitData.push(dayProfitToday);

        anaTrendChart = new Chart(ctxTrend, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    { label: 'Ventas USD', data: salesData, borderColor: '#6366f1', backgroundColor: '#6366f120', fill: true, tension: 0.4 },
                    { label: 'Utilidad USD', data: profitData, borderColor: '#10b981', backgroundColor: '#10b98120', fill: true, tension: 0.4 }
                ]
            },
            options: { 
                responsive: true, 
                maintainAspectRatio: false, 
                plugins: { legend: { position: 'top', labels: { font: { weight: 'bold' } } } },
                scales: { y: { beginAtZero: true }, x: { grid: { display: false } } }
            }
        });

        // Eficiencia (Ganancia vs Gastos)
        const totalExpensesUSD = (window.expenses || []).reduce((acc, e) => acc + (Number(e.amountUSD) || 0), 0);
        const netProfit = Math.max(0, dayProfitToday - totalExpensesUSD);
        
        // UI Update (Absolutes)
        const elProfit = document.getElementById('ana-eff-profit-val');
        const elExpense = document.getElementById('ana-eff-expense-val');
        if(elProfit) elProfit.textContent = `$${netProfit.toFixed(2)}`;
        if(elExpense) elExpense.textContent = `$${totalExpensesUSD.toFixed(2)}`;

        anaEfficiencyChart = new Chart(ctxEff, {
            type: 'doughnut',
            data: {
                labels: ['Ganancia Neta', 'Gastos'],
                datasets: [{
                    data: [netProfit, totalExpensesUSD],
                    backgroundColor: ['#10b981', '#f43f5e'],
                    borderWidth: 0
                }]
            },
            options: { cutout: '70%', responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } } }
        });
    }

    function renderInternalCharts(catTotals, methodTotals) {
        const canvasCat = document.getElementById('view-chart-category');
        const canvasPay = document.getElementById('view-chart-payment');
        if (!canvasCat || !canvasPay) return;

        const ctxCat = canvasCat.getContext('2d');
        const ctxPay = canvasPay.getContext('2d');

        if (chartCategory) chartCategory.destroy();
        if (chartPayment) chartPayment.destroy();

        const categories = Object.keys(catTotals);
        if (categories.length === 0) return;

        chartCategory = new Chart(ctxCat, {
            type: 'doughnut',
            data: {
                labels: categories,
                datasets: [{
                    data: Object.values(catTotals),
                    backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'],
                    borderWidth: 0
                }]
            },
            options: {
                cutout: '65%',
                plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { weight: 'bold' } } } }
            }
        });

        chartPayment = new Chart(ctxPay, {
            type: 'bar',
            data: {
                labels: ['Efec $', 'Efec BS', 'Punto BS'],
                datasets: [{
                    label: 'Ventas (VES)',
                    data: [methodTotals['cash-usd'], methodTotals['cash-ves'], methodTotals['card-ves']],
                    backgroundColor: ['#10b981', '#2563eb', '#6366f1'],
                    borderRadius: 8
                }]
            },
            options: {
                responsive: true,
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true, grid: { display: false } },
                    x: { grid: { display: false } }
                }
            }
        });
    }

    return {
        renderAnalyticsCharts,
        renderInternalCharts
    };
})();
