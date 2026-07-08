/**
 * Tests para módulo de utilidades (src/renderer/utils.js)
 */

import { formatMoney, safeParse, calcCartTotal, roundTo, parseMobilePayment, searchProducts, debounce } from '../src/renderer/utils.ts';

describe('utils — formatMoney', () => {
    test('formats number with 2 decimals', () => {
        expect(formatMoney(100)).toBe('100.00');
        expect(formatMoney(99.5)).toBe('99.50');
        expect(formatMoney(0)).toBe('0.00');
    });

    test('handles null/undefined', () => {
        expect(formatMoney(null)).toBe('0.00');
        expect(formatMoney(undefined)).toBe('0.00');
    });
});

describe('utils — safeParse', () => {
    test('parses valid JSON', () => {
        expect(safeParse('{"a":1}', {})).toEqual({ a: 1 });
    });

    test('returns fallback for invalid JSON', () => {
        const fallback = [];
        expect(safeParse('not json', fallback)).toBe(fallback);
    });
});

describe('utils — calcCartTotal', () => {
    test('calculates total', () => {
        const cart = [
            { qty: 2, price: 10 },
            { qty: 1, price: 5.5 },
        ];
        expect(calcCartTotal(cart)).toBe(25.5);
    });

    test('returns 0 for empty cart', () => {
        expect(calcCartTotal([])).toBe(0);
    });
});

describe('utils — roundTo', () => {
    test('rounds correctly', () => {
        expect(roundTo(10.456, 2)).toBe(10.46);
        expect(roundTo(10.454, 2)).toBe(10.45);
    });
});

describe('utils — parseMobilePayment', () => {
    test('parses Banesco SMS', () => {
        const result = parseMobilePayment('Pago recibido Bs. 46,00 Banesco Ref 12345678');
        expect(result).not.toBeNull();
        expect(result.amount).toBe(46);
        expect(result.bank).toBe('Banesco');
        expect(result.reference).toBe('12345678');
    });

    test('returns null for non-payment text', () => {
        expect(parseMobilePayment('Hola como estas')).toBeNull();
    });
});

describe('utils — searchProducts', () => {
    const products = [
        { name: 'Coca Cola', category: 'Gaseosas', barcode: '123' },
        { name: 'Agua Mineral', category: 'Aguas', barcode: '456' },
    ];

    test('filters by name', () => {
        const result = searchProducts(products, 'coca');
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('Coca Cola');
    });

    test('returns all for empty query', () => {
        expect(searchProducts(products, '')).toHaveLength(2);
        expect(searchProducts(products, null)).toHaveLength(2);
    });
});

describe('utils — debounce', () => {
    jest.useFakeTimers();

    test('delays execution', () => {
        const fn = jest.fn();
        const debounced = debounce(fn, 300);

        debounced();
        expect(fn).not.toHaveBeenCalled();

        jest.advanceTimersByTime(300);
        expect(fn).toHaveBeenCalledTimes(1);
    });
});
