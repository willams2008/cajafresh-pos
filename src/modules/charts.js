window.Charts = (function() {
    var chartCategory = null;
    var chartPayment = null;
    var anaTrendChart = null;
    var anaEfficiencyChart = null;

    function renderAnalyticsCharts(dayProfitToday) {
        var canvasTrend = document.getElementById('ana-chart-trend');
        var canvasEff = document.getElementById('ana-chart-efficiency');
        if (!canvasTrend || !canvasEff) return;

        var ctxTrend = canvasTrend.getContext('2d');
        var ctxEff = canvasEff.getContext('2d');

        if (anaTrendChart) anaTrendChart.destroy();
        if (anaEfficiencyChart) anaEfficiencyChart.destroy();

        var historyLast = (window.dailyHistory || []).slice(-6);
        var labels = historyLast.map(function(d) {
            return new Date(d.date).toLocaleDateString('es-VE', {day:'2-digit', month:'short'});
        });
        labels.push('Hoy');

        var salesData = historyLast.map(function(d) { return d.salesUSD; });
        salesData.push((window.sales || []).reduce(function(acc, s) { return acc + (s.totalUSD || 0); }, 0));

        var profitData = historyLast.map(function(d) { return d.profitUSD; });
        profitData.push(dayProfitToday);

        anaTrendChart = new Chart(ctxTrend, {
            type: 'line',
            data: {
                labels: labels,
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

        var totalExpensesUSD = (window.expenses || []).reduce(function(acc, e) { return acc + (e.amountUSD || 0); }, 0);
        var netProfit = Math.max(0, dayProfitToday - totalExpensesUSD);

        var elProfit = document.getElementById('ana-eff-profit-val');
        var elExpense = document.getElementById('ana-eff-expense-val');
        if (elProfit) elProfit.textContent = '$' + netProfit.toFixed(2);
        if (elExpense) elExpense.textContent = '$' + totalExpensesUSD.toFixed(2);

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
        var ctxCat = document.getElementById('view-chart-category').getContext('2d');
        var ctxPay = document.getElementById('view-chart-payment').getContext('2d');

        if (chartCategory) chartCategory.destroy();
        if (chartPayment) chartPayment.destroy();

        var categories = Object.keys(catTotals);
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
                    data: [methodTotals['cash-usd'] || 0, methodTotals['cash-ves'] || 0, methodTotals['card-ves'] || 0],
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

    function formatUSD(val) {
        if (isNaN(val)) val = 0;
        return '$' + Number(val).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
    }

    return {
        renderAnalyticsCharts: renderAnalyticsCharts,
        renderInternalCharts: renderInternalCharts,
        formatUSD: formatUSD
    };
})();
