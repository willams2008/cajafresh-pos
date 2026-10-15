/**
 * Tests unitarios para lógica de ventas y cálculos multi-moneda
 */

const { formatMoney, roundTo } = require('../src/renderer/utils.ts');

describe('Sales & Multi-currency Calculations', () => {
    const exchangeRate = 36.5;
    const euroRate = 39.8;

    test('calcula subtotal por ítem correctamente', () => {
        const item = { priceUSD: 12.50, qty: 3 };
        const subtotal = item.priceUSD * item.qty;
        expect(roundTo(subtotal, 2)).toBe(37.50);
    });

    test('convierte correctamente a VES y EUR según tasas del día', () => {
        const totalUSD = 100.00;
        const totalVES = roundTo(totalUSD * exchangeRate, 2);
        const totalEUR = roundTo(totalUSD * (exchangeRate / euroRate), 2);

        expect(totalVES).toBe(3650.00);
        expect(totalEUR).toBeCloseTo(91.71, 1);
    });

    test('calcula vuelto en USD cuando el cliente paga en efectivo USD', () => {
        const totalUSD = 24.50;
        const paidUSD = 50.00;
        const changeUSD = roundTo(paidUSD - totalUSD, 2);

        expect(changeUSD).toBe(25.50);
    });

    test('calcula vuelto equivalente en VES si no hay cambio en USD', () => {
        const totalUSD = 24.50;
        const paidUSD = 50.00;
        const changeUSD = paidUSD - totalUSD;
        const changeVES = roundTo(changeUSD * exchangeRate, 2);

        expect(changeVES).toBe(930.75);
    });

    test('aplica descuentos porcentuales sin permitir montos negativos', () => {
        const originalTotal = 150.00;
        const discountPercent = 15; // 15% off

        const discountAmount = roundTo(originalTotal * (discountPercent / 100), 2);
        const finalTotal = roundTo(originalTotal - discountAmount, 2);

        expect(discountAmount).toBe(22.50);
        expect(finalTotal).toBe(127.50);

        // Descuento mayor a 100% no debe dar negativo
        const invalidDiscount = 120;
        const cappedDiscount = Math.min(invalidDiscount, 100);
        const protectedTotal = Math.max(0, originalTotal - (originalTotal * cappedDiscount / 100));
        expect(protectedTotal).toBe(0);
    });

    test('valida desglose de pago mixto (Efectivo USD + Pago Móvil VES)', () => {
        const totalUSD = 50.00;
        const paidCashUSD = 20.00;
        const remainingUSD = totalUSD - paidCashUSD; // 30 USD
        const expectedPagoMovilVES = roundTo(remainingUSD * exchangeRate, 2); // 1095 VES

        const paymentBreakdown = {
            usd_cash: paidCashUSD,
            ves_pagomovil: expectedPagoMovilVES,
        };

        const totalPaidEquivUSD = roundTo(paymentBreakdown.usd_cash + (paymentBreakdown.ves_pagomovil / exchangeRate), 2);
        expect(totalPaidEquivUSD).toBe(50.00);
    });

    test('formatea moneda correctamente para tickets', () => {
        expect(formatMoney(1234.56)).toBe('1234.56');
        expect(formatMoney(0)).toBe('0.00');
        expect(formatMoney(null)).toBe('0.00');
    });
});
