/**
 * Tests de integración para database.js
 */

const path = require('path');
const os = require('os');
const fs = require('fs');

// ─── Mock electron.app.getPath ──────────────────────────────────
const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-test-db-'));
const mockUserData = path.join(tmpBase, 'userData');
fs.mkdirSync(mockUserData, { recursive: true });

jest.mock('electron', () => ({
    app: {
        getPath: jest.fn(() => mockUserData),
    },
}));

const { initDatabase, api } = require('../database');

const testStoreId = 'store_test_001';

beforeAll(async () => {
    await initDatabase(mockUserData);
}, 15000);

afterAll(() => {
    try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

// ─── Helpers ──────────────────────────────────────────────────
const _uid = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

function makeProduct(overrides = {}) {
    return {
        id: `prod_${_uid()}`,
        name: overrides.name || 'Producto Test',
        category: overrides.category || 'Gaseosas',
        priceUSD: overrides.priceUSD || 10,
        priceVES: overrides.priceVES || 400,
        costPrice: overrides.costPrice || 5,
        stock: overrides.stock || 100,
        minStock: overrides.minStock || 5,
        featured: 0,
        flavors: '[]',
        expiryDate: '',
        description: '',
        img: '',
        barcode: '',
        ...overrides,
    };
}

function makeClient(overrides = {}) {
    return {
        id: `clt_${_uid()}`,
        document: overrides.document || 'V12345678',
        name: overrides.name || 'Cliente Test',
        phone: overrides.phone || '04121234567',
        type: 'cliente',
        ...overrides,
    };
}

function makeSale(overrides = {}) {
    return {
        id: `sale_${_uid()}`,
        date: new Date().toISOString(),
        timestamp: Date.now(),
        items: overrides.items || [{ id: 'prod_1', name: 'Coca Cola', qty: 2, price: 10 }],
        totalUSD: overrides.totalUSD || 20,
        method: overrides.method || 'Efectivo USD',
        status: overrides.status || 'paid',
        payments: null,
        cashierName: 'Cajero Test',
        discount: 0,
        tax: 0,
        ...overrides,
    };
}

// ═════════════════════════════════════════════════════════════
// PRODUCTOS
// ═════════════════════════════════════════════════════════════
describe('Database — Products', () => {
    test('CRUD completo', async () => {
        const p = makeProduct({ name: 'Test CRUD', category: 'Pruebas' });

        await api.saveProduct(testStoreId, p);
        const products = await api.getProducts(testStoreId);
        expect(products.find(pr => pr.id === p.id).name).toBe('Test CRUD');

        p.name = 'Actualizado';
        p.stock = 50;
        await api.saveProduct(testStoreId, p);
        const products2 = await api.getProducts(testStoreId);
        expect(products2.find(pr => pr.id === p.id).name).toBe('Actualizado');
        expect(products2.find(pr => pr.id === p.id).stock).toBe(50);

        await api.deleteProduct(testStoreId, p.id);
        const products3 = await api.getProducts(testStoreId);
        expect(products3.find(pr => pr.id === p.id)).toBeUndefined();
    });

    test('Bulk save', async () => {
        const ps = [makeProduct({ name: 'B1' }), makeProduct({ name: 'B2' })];
        await api.saveProductsBulk(testStoreId, ps);
        const all = await api.getProducts(testStoreId);
        ps.forEach(p => expect(all.find(x => x.id === p.id)).toBeDefined());
    });

    test('Campos completos', async () => {
        const p = makeProduct({
            name: 'Full',
            priceUSD: 25.5, priceVES: 1020, priceEUR: 22,
            costPrice: 12.3, stock: 200, minStock: 10,
            barcode: '7891234567890',
        });
        await api.saveProduct(testStoreId, p);
        const found = (await api.getProducts(testStoreId)).find(x => x.id === p.id);
        expect(Number(found.priceUSD)).toBe(25.5);
        expect(Number(found.costPrice)).toBe(12.3);
        expect(found.barcode).toBe('7891234567890');
    });
});

// ═════════════════════════════════════════════════════════════
// CLIENTES
// ═════════════════════════════════════════════════════════════
describe('Database — Clients', () => {
    test('CRUD', async () => {
        await api.saveClient(testStoreId, makeClient({ name: 'Juan', document: 'V1' }));
        const clients = await api.getClients(testStoreId);
        expect(clients.find(c => c.document === 'V1').name).toBe('Juan');
    });
});

// ═════════════════════════════════════════════════════════════
// VENTAS
// ═════════════════════════════════════════════════════════════
describe('Database — Sales', () => {
    test('Crear venta con items', async () => {
        const sale = makeSale({
            items: [{ id: 'p1', name: 'Coca', qty: 2, price: 10 }, { id: 'p2', name: 'Polar', qty: 1, price: 5 }],
            totalUSD: 25,
        });
        await api.saveSale(testStoreId, sale);
        const found = (await api.getSales(testStoreId)).find(s => s.id === sale.id);
        expect(found.method).toBe('Efectivo USD');
        const items = typeof found.items === 'string' ? JSON.parse(found.items) : found.items;
        expect(items).toHaveLength(2);
    });

    test('Void sale', async () => {
        const sale = makeSale({ status: 'paid' });
        await api.saveSale(testStoreId, sale);
        await api.voidSale(testStoreId, sale.id);
        expect((await api.getSales(testStoreId)).find(s => s.id === sale.id).status).toBe('void');
    });

    test('Venta a crédito crea registro', async () => {
        const client = makeClient({ name: 'Fiado' });
        await api.saveClient(testStoreId, client);

        const sale = makeSale({ method: 'Fiado', clientId: client.id, totalUSD: 100 });
        await api.saveSale(testStoreId, sale);

        const credits = await api.getCredits(testStoreId);
        const found = credits.find(c => c.sale_ticket === sale.id);
        expect(found).toBeDefined();
        expect(Number(found.amount_owed)).toBe(100);
    });

    test('Filtrar por rango de fecha', async () => {
        const s1 = makeSale({ id: `sr1_${_uid()}`, timestamp: Date.now() - 86400000, date: new Date(Date.now() - 86400000).toISOString() });
        const s2 = makeSale({ id: `sr2_${_uid()}`, timestamp: Date.now(), date: new Date().toISOString() });
        await api.saveSale(testStoreId, s1);
        await api.saveSale(testStoreId, s2);

        const r = await api.getSalesByDate(testStoreId, Date.now() - 172800000, Date.now() + 86400000);
        expect(r.length).toBeGreaterThanOrEqual(2);
    });
});

// ═════════════════════════════════════════════════════════════
// CRÉDITOS (verifica status PENDING antes de pagar por completo)
// ═════════════════════════════════════════════════════════════
describe('Database — Credits', () => {
    test('Pago parcial y total (status PAID al completar)', async () => {
        const client = makeClient();
        await api.saveClient(testStoreId, client);

        const sale = makeSale({ method: 'Crédito', clientId: client.id, totalUSD: 50 });
        await api.saveSale(testStoreId, sale);

        // Obtener crédito (solo PENDING)
        const credits = await api.getCredits(testStoreId);
        const credit = credits.find(c => c.sale_ticket === sale.id);
        expect(credit).toBeDefined();
        expect(credit.id).toBeDefined();
        expect(Number(credit.amount_paid)).toBe(0);

        // Pago parcial — crédito sigue PENDING
        await api.addCreditPayment(testStoreId, credit.id, 30, 'Efectivo USD');
        const afterPartial = await api.getCredits(testStoreId);
        const partial = afterPartial.find(c => c.id === credit.id);
        expect(partial).toBeDefined();
        expect(Number(partial.amount_paid)).toBe(30);
        expect(partial.status).toBe('PENDING');

        // Pago completo — crédito sale de getCredits (pasa a PAID)
        await api.addCreditPayment(testStoreId, credit.id, 20, 'Efectivo USD');
        const afterFull = await api.getCredits(testStoreId);
        const paidCredit = afterFull.find(c => c.id === credit.id);
        expect(paidCredit).toBeUndefined(); // crédito pagado no debe aparecer en PENDING

        // Verificar directamente en BD que el crédito quedó PAID
        const allCredits = await new Promise((resolve, reject) => {
            const sqlite3 = require('sqlite3').verbose();
            const dbPath = path.join(mockUserData, 'database', 'freshpos.sqlite');
            const db = new sqlite3.Database(dbPath, (err) => {
                if (err) return reject(err);
                db.all('SELECT * FROM credits WHERE id = ?', [credit.id], (err2, rows) => {
                    db.close();
                    if (err2) reject(err2);
                    else resolve(rows);
                });
            });
        });
        expect(allCredits).toHaveLength(1);
        expect(Number(allCredits[0].amount_paid)).toBe(50);
        expect(allCredits[0].status).toBe('PAID');
    });
});

// ═════════════════════════════════════════════════════════════
// ARQUEOS
// ═════════════════════════════════════════════════════════════
describe('Database — Cashups', () => {
    test('Guardar y recuperar arqueo', async () => {
        const c = { id: `cu_${_uid()}`, date: new Date().toISOString(), cash_usd: 500, cash_ves: 20000, sales_usd: 480, sales_ves: 19500, diff_usd: 20, cashier_name: 'Test', notes: '' };
        await api.saveCashup(testStoreId, c);
        const found = (await api.getCashups(testStoreId)).find(x => x.id === c.id);
        expect(Number(found.cash_usd)).toBe(500);
        expect(Number(found.diff_usd)).toBe(20);
    });
});

// ═════════════════════════════════════════════════════════════
// MOVIMIENTOS (MERMA)
// ═════════════════════════════════════════════════════════════
describe('Database — Movements', () => {
    test('Guardar movimiento', async () => {
        const m = { id: `mv_${_uid()}`, product_id: 'p1', product_name: 'Test', type: 'merma', quantity: 5, reason: 'Vencido', date: new Date().toISOString(), timestamp: Date.now(), cashier_name: 'Test' };
        await api.saveMovement(testStoreId, m);
        expect((await api.getMovements(testStoreId)).find(x => x.id === m.id)).toBeDefined();
    });
});

// ═════════════════════════════════════════════════════════════
// PUNTOS DE LEALTAD
// ═════════════════════════════════════════════════════════════
describe('Database — Loyalty', () => {
    test('Acumular y canjear', async () => {
        const client = makeClient();
        await api.saveClient(testStoreId, client);

        await api.addLoyaltyPoints(testStoreId, client.id, 100, 500);
        let l = await api.getClientLoyalty(testStoreId, client.id);
        expect(Number(l.points)).toBe(100);
        expect(Number(l.total_spent)).toBe(500);

        await api.addLoyaltyPoints(testStoreId, client.id, 50, 200);
        l = await api.getClientLoyalty(testStoreId, client.id);
        expect(Number(l.points)).toBe(150);

        await api.redeemLoyaltyPoints(testStoreId, client.id, 30);
        l = await api.getClientLoyalty(testStoreId, client.id);
        expect(Number(l.points)).toBe(120);
    });
});

// ═════════════════════════════════════════════════════════════
// MULTI-TENANT
// ═════════════════════════════════════════════════════════════
describe('Database — Multi-tenant', () => {
    test('Aislamiento entre tiendas', async () => {
        const a = 'store_a', b = 'store_b';
        await api.saveProduct(a, makeProduct({ name: 'Solo A' }));
        await api.saveProduct(b, makeProduct({ name: 'Solo B' }));

        const pa = await api.getProducts(a), pb = await api.getProducts(b);
        expect(pa.find(x => x.name === 'Solo A')).toBeDefined();
        expect(pa.find(x => x.name === 'Solo B')).toBeUndefined();
        expect(pb.find(x => x.name === 'Solo B')).toBeDefined();
        expect(pb.find(x => x.name === 'Solo A')).toBeUndefined();
    });
});

// ═════════════════════════════════════════════════════════════
// INGREDIENTES Y RECETAS
// ═════════════════════════════════════════════════════════════
describe('Database — Ingredients & Recipes', () => {
    test('CRUD ingredients', async () => {
        await api.saveIngredient(testStoreId, { id: `ing_${_uid()}`, name: 'Harina', unit: 'kg', cost: 2.5, stock: 50, minStock: 10 });
        const ings = await api.getIngredients(testStoreId);
        expect(ings.find(i => i.name === 'Harina')).toBeDefined();
    });

    test('CRUD recipes', async () => {
        const pid = `pr_${_uid()}`, iid = `ing_${_uid()}`;
        await api.saveProduct(testStoreId, makeProduct({ id: pid }));
        await api.saveIngredient(testStoreId, { id: iid, name: 'Leche', unit: 'L', cost: 1.5, stock: 20, minStock: 5 });
        await api.saveRecipe(testStoreId, { id: `rec_${_uid()}`, product_id: pid, ingredient_id: iid, quantity: 0.5 });

        const recipes = await api.getRecipes(testStoreId);
        expect(recipes.find(r => r.product_id === pid)).toBeDefined();
    });
});
