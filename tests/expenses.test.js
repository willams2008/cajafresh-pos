/**
 * Tests unitarios para Gestión de Gastos Diarios y Categorías
 */

describe('Expenses Management', () => {
    const expenseCategories = ['Servicios', 'Nómina', 'Proveedores', 'Mantenimiento', 'Otros'];

    function filterExpensesByDate(expenses, dateStr) {
        return expenses.filter(e => e.date && e.date.startsWith(dateStr));
    }

    function calculateTotalExpenses(expenses, exchangeRate = 36.5) {
        let totalUSD = 0;
        let totalVES = 0;

        expenses.forEach(e => {
            if (e.currency === 'USD') {
                totalUSD += Number(e.amount) || 0;
            } else if (e.currency === 'VES') {
                totalVES += Number(e.amount) || 0;
            }
        });

        const unifiedUSD = parseFloat((totalUSD + (totalVES / exchangeRate)).toFixed(2));
        return { totalUSD, totalVES, unifiedUSD };
    }

    test('valida categorías de gastos permitidas', () => {
        expect(expenseCategories).toContain('Servicios');
        expect(expenseCategories).toContain('Proveedores');
        expect(expenseCategories).toContain('Mantenimiento');
    });

    test('filtra gastos por fecha del día', () => {
        const expenses = [
            { id: '1', date: '2026-10-09 10:30:00', amount: 15, currency: 'USD' },
            { id: '2', date: '2026-10-09 14:15:00', amount: 200, currency: 'VES' },
            { id: '3', date: '2026-10-08 18:00:00', amount: 50, currency: 'USD' },
        ];

        const today = filterExpensesByDate(expenses, '2026-10-09');
        expect(today).toHaveLength(2);
        expect(today.map(e => e.id)).toEqual(['1', '2']);
    });

    test('totaliza gastos en USD y VES unificando a USD equivalente', () => {
        const rate = 36.5;
        const dailyExpenses = [
            { amount: 25.00, currency: 'USD' },
            { amount: 50.00, currency: 'USD' },
            { amount: 365.00, currency: 'VES' }, // Equivale a $10.00
        ];

        const res = calculateTotalExpenses(dailyExpenses, rate);
        expect(res.totalUSD).toBe(75.00);
        expect(res.totalVES).toBe(365.00);
        expect(res.unifiedUSD).toBe(85.00);
    });
});
