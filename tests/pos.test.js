/**
 * Tests para módulo POS (src/renderer/pos.js)
 */

import { resetState, getCart } from '../src/renderer/state.js';
import { addToCart, removeFromCart, clearCart } from '../src/renderer/pos.js';

// Mock DOM
global.document = {
    getElementById: jest.fn(() => null),
};

describe('POS Module — Cart Operations', () => {
    beforeEach(() => {
        resetState();
    });

    test('addToCart adds new product', () => {
        const product = { id: '1', name: 'Coca Cola', priceUSD: 2.5 };
        addToCart(product, 1);

        const cart = getCart();
        expect(cart).toHaveLength(1);
        expect(cart[0].name).toBe('Coca Cola');
        expect(cart[0].qty).toBe(1);
    });

    test('addToCart increments quantity for existing product', () => {
        const product = { id: '1', name: 'Coca Cola', priceUSD: 2.5 };

        addToCart(product, 1);
        addToCart(product, 2);

        const cart = getCart();
        expect(cart).toHaveLength(1);
        expect(cart[0].qty).toBe(3);
    });

    test('removeFromCart removes product', () => {
        addToCart({ id: '1', name: 'A', priceUSD: 1 }, 1);
        expect(getCart()).toHaveLength(1);

        removeFromCart('1');
        expect(getCart()).toHaveLength(0);
    });

    test('clearCart empties the cart', () => {
        addToCart({ id: '1', name: 'A', priceUSD: 1 }, 1);
        addToCart({ id: '2', name: 'B', priceUSD: 2 }, 2);
        expect(getCart()).toHaveLength(2);

        clearCart();
        expect(getCart()).toHaveLength(0);
    });
});
