/**
 * Tests unitarios para lógica de Inventario y Control de Stock
 */

describe('Inventory & Stock Management', () => {
    function canSell(product, qtyToSell) {
        const availableStock = product.stock || 0;
        return availableStock > 0 && availableStock >= qtyToSell;
    }

    function isLowStock(product) {
        const stock = product.stock || 0;
        const min = product.minStock || 0;
        return stock <= min;
    }

    function calculateMargin(priceUSD, costPrice) {
        if (!priceUSD || priceUSD <= 0) return 0;
        return parseFloat((((priceUSD - costPrice) / priceUSD) * 100).toFixed(2));
    }

    test('previene venta cuando stock es undefined, null o 0', () => {
        const prodUndefined = { id: 'p1', name: 'Item 1' }; // stock undefined
        const prodZero = { id: 'p2', name: 'Item 2', stock: 0 };
        const prodNegative = { id: 'p3', name: 'Item 3', stock: -1 };
        const prodNormal = { id: 'p4', name: 'Item 4', stock: 5 };

        expect(canSell(prodUndefined, 1)).toBe(false);
        expect(canSell(prodZero, 1)).toBe(false);
        expect(canSell(prodNegative, 1)).toBe(false);
        expect(canSell(prodNormal, 2)).toBe(true);
        expect(canSell(prodNormal, 6)).toBe(false);
    });

    test('detecta productos con stock bajo o agotado', () => {
        const p1 = { name: 'Harina', stock: 2, minStock: 5 };
        const p2 = { name: 'Azúcar', stock: 5, minStock: 5 };
        const p3 = { name: 'Café', stock: 10, minStock: 5 };
        const pCorrupto = { name: 'Leche', stock: undefined, minStock: 3 };

        expect(isLowStock(p1)).toBe(true);
        expect(isLowStock(p2)).toBe(true); // al límite
        expect(isLowStock(p3)).toBe(false);
        expect(isLowStock(pCorrupto)).toBe(true); // 0 <= 3
    });

    test('calcula márgenes de ganancia con precisión', () => {
        expect(calculateMargin(10, 6)).toBe(40.00); // (10-6)/10 = 40%
        expect(calculateMargin(25, 20)).toBe(20.00);
        expect(calculateMargin(0, 5)).toBe(0); // Sin precio no hay división por 0
    });

    test('descuenta stock con precisión tras una venta múltiple', () => {
        const inventory = {
            'prod_1': { id: 'prod_1', stock: 20 },
            'prod_2': { id: 'prod_2', stock: 15 },
        };

        const cartItems = [
            { id: 'prod_1', qty: 3 },
            { id: 'prod_2', qty: 5 },
        ];

        // Reducir stock
        cartItems.forEach(item => {
            if (inventory[item.id]) {
                inventory[item.id].stock -= item.qty;
            }
        });

        expect(inventory['prod_1'].stock).toBe(17);
        expect(inventory['prod_2'].stock).toBe(10);
    });
});
