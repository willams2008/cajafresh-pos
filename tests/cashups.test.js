/**
 * Tests unitarios para Cierre de Caja / Corte Z y Cuadre de Efectivo
 */

describe('Cashup & Corte Z System', () => {
    function calculateCashupDifferences({
        openingUSD = 0,
        openingVES = 0,
        salesCashUSD = 0,
        salesCashVES = 0,
        expensesUSD = 0,
        expensesVES = 0,
        countedUSD = 0,
        countedVES = 0,
    }) {
        const expectedUSD = openingUSD + salesCashUSD - expensesUSD;
        const expectedVES = openingVES + salesCashVES - expensesVES;

        const diffUSD = parseFloat((countedUSD - expectedUSD).toFixed(2));
        const diffVES = parseFloat((countedVES - expectedVES).toFixed(2));

        return {
            expectedUSD,
            expectedVES,
            diffUSD,
            diffVES,
            isExactUSD: diffUSD === 0,
            isExactVES: diffVES === 0,
        };
    }

    function formatWhatsAppCierre({
        storeName,
        date,
        totalUSD,
        salesBreakdown,
        countedUSD,
        diffUSD,
    }) {
        return (
            `*CIERRE DE CAJA — ${storeName}*\n` +
            `📅 Fecha: ${date}\n` +
            `💰 Ventas Totales: $${totalUSD.toFixed(2)}\n` +
            `💵 Efectivo USD: $${(salesBreakdown.usd_cash || 0).toFixed(2)}\n` +
            `📱 Pago Móvil: Bs ${(salesBreakdown.ves_pm || 0).toFixed(2)}\n` +
            `💳 Punto: Bs ${(salesBreakdown.ves_card || 0).toFixed(2)}\n` +
            `🔍 Arqueo Físico USD: $${countedUSD.toFixed(2)}\n` +
            `⚖️ Diferencia USD: ${diffUSD >= 0 ? '+' : ''}$${diffUSD.toFixed(2)}`
        );
    }

    test('cuadre exacto cuando el efectivo físico coincide con lo esperado', () => {
        const res = calculateCashupDifferences({
            openingUSD: 50,
            salesCashUSD: 120,
            expensesUSD: 10,
            countedUSD: 160, // 50 + 120 - 10 = 160
            openingVES: 0,
            salesCashVES: 0,
            countedVES: 0,
        });

        expect(res.expectedUSD).toBe(160);
        expect(res.diffUSD).toBe(0);
        expect(res.isExactUSD).toBe(true);
    });

    test('detecta faltante de caja correctamente (número negativo)', () => {
        const res = calculateCashupDifferences({
            openingUSD: 100,
            salesCashUSD: 200,
            expensesUSD: 0,
            countedUSD: 290, // Faltan $10
        });

        expect(res.expectedUSD).toBe(300);
        expect(res.diffUSD).toBe(-10.00);
        expect(res.isExactUSD).toBe(false);
    });

    test('detecta sobrante de caja correctamente (número positivo)', () => {
        const res = calculateCashupDifferences({
            openingUSD: 20,
            salesCashUSD: 80,
            expensesUSD: 5,
            countedUSD: 105, // Esperado 95 -> Sobran $10
        });

        expect(res.expectedUSD).toBe(95);
        expect(res.diffUSD).toBe(10.00);
    });

    test('genera resumen para notificación de WhatsApp con formato correcto', () => {
        const msg = formatWhatsAppCierre({
            storeName: 'Punto Pila Principal',
            date: '2026-10-09',
            totalUSD: 450.50,
            salesBreakdown: {
                usd_cash: 200,
                ves_pm: 5400,
                ves_card: 3200,
            },
            countedUSD: 200,
            diffUSD: 0,
        });

        expect(msg).toContain('CIERRE DE CAJA — Punto Pila Principal');
        expect(msg).toContain('💰 Ventas Totales: $450.50');
        expect(msg).toContain('⚖️ Diferencia USD: +$0.00');
    });
});
