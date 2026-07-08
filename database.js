const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

let db;

function backupDatabaseDaily(dbDir, dbPath) {
    try {
        if (!fs.existsSync(dbPath)) return;
        const backupDir = path.join(dbDir, 'backups');
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }
        
        // Local date string YYYY-MM-DD
        const today = new Date();
        const dateStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
        const backupFilename = `freshpos_backup_${dateStr}.sqlite`;
        const backupFilePath = path.join(backupDir, backupFilename);
        
        if (!fs.existsSync(backupFilePath)) {
            fs.copyFileSync(dbPath, backupFilePath);
            console.log('[DATABASE] Backup diario creado:', backupFilename);
        }
        
        // Delete older backups
        const files = fs.readdirSync(backupDir);
        files.forEach(file => {
            if (file.startsWith('freshpos_backup_') && file.endsWith('.sqlite') && file !== backupFilename) {
                fs.unlinkSync(path.join(backupDir, file));
                console.log('[DATABASE] Backup antiguo eliminado:', file);
            }
        });
    } catch(err) {
        console.error('[DATABASE] Error creando backup:', err);
    }
}

function initDatabase(userDataPath) {
    return new Promise((resolve, reject) => {
        const dbDir = path.join(userDataPath, 'database');
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }
        
        const dbPath = path.join(dbDir, 'freshpos.sqlite');
        
        // Trigger daily backup
        backupDatabaseDaily(dbDir, dbPath);
        
        console.log('[DATABASE] Conectando a:', dbPath);
        
        db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                console.error('[DATABASE] Error conectando:', err);
                reject(err);
                return;
            }
            
            console.log('[DATABASE] Conexión establecida.');
            createTables().then(resolve).catch(reject);
        });
    });
}

function runQuery(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

function getQuery(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

async function createTables() {
    // Tabla de Productos con store_id
    await runQuery(`
        CREATE TABLE IF NOT EXISTS products (
            id TEXT,
            store_id TEXT,
            name TEXT NOT NULL,
            category TEXT,
            priceUSD REAL,
            priceVES REAL,
            priceEUR REAL,
            costPrice REAL,
            stock INTEGER,
            minStock INTEGER,
            featured INTEGER,
            flavors TEXT,
            expiryDate TEXT,
            description TEXT,
            img TEXT,
            PRIMARY KEY (id, store_id)
        )
    `);

    // Migración para añadir store_id si no existe
    try {
        await runQuery(`ALTER TABLE products ADD COLUMN store_id TEXT`);
    } catch(e) { /* Columna ya existe o error ignorado */ }
    
    // Migraciones de nuevas columnas en products
    const productCols = [
        'priceEUR REAL',
        'costPrice REAL',
        'minStock INTEGER',
        'featured INTEGER',
        'flavors TEXT',
        'expiryDate TEXT',
        'description TEXT',
        'barcode TEXT'
    ];
    for (const col of productCols) {
        try {
            await runQuery(`ALTER TABLE products ADD COLUMN ${col}`);
        } catch(e) {}
    }

    // Tabla de Ingredientes (Materia Prima)
    await runQuery(`
        CREATE TABLE IF NOT EXISTS ingredients (
            id TEXT,
            store_id TEXT,
            name TEXT NOT NULL,
            unit TEXT,
            cost REAL,
            stock REAL,
            minStock REAL,
            PRIMARY KEY (id, store_id)
        )
    `);

    // Tabla de Recetas (Escandallos)
    await runQuery(`
        CREATE TABLE IF NOT EXISTS recipes (
            id TEXT,
            store_id TEXT,
            product_id TEXT,
            ingredient_id TEXT,
            quantity REAL,
            PRIMARY KEY (id, store_id)
        )
    `);

    // Tabla de Clientes con store_id
    await runQuery(`
        CREATE TABLE IF NOT EXISTS clients (
            id TEXT,
            store_id TEXT,
            document TEXT,
            name TEXT,
            phone TEXT,
            PRIMARY KEY (id, store_id)
        )
    `);
    try {
        await runQuery(`ALTER TABLE clients ADD COLUMN store_id TEXT`);
    } catch(e) {}
    try {
        await runQuery(`ALTER TABLE clients ADD COLUMN type TEXT`);
    } catch(e) { /* Columna ya existe */ }

    // Tabla de Ventas con store_id
    await runQuery(`
        CREATE TABLE IF NOT EXISTS sales (
            id TEXT,
            store_id TEXT,
            date TEXT,
            timestamp INTEGER,
            total REAL,
            method TEXT,
            client_id TEXT,
            items TEXT,
            pagoMovilRef TEXT,
            subtotal REAL,
            tax REAL,
            PRIMARY KEY (id, store_id)
        )
    `);
    try {
        await runQuery(`ALTER TABLE sales ADD COLUMN store_id TEXT`);
    } catch(e) {}
    try {
        await runQuery(`ALTER TABLE sales ADD COLUMN payments TEXT`);
    } catch(e) {}
    try {
        await runQuery(`ALTER TABLE sales ADD COLUMN cashier_name TEXT`);
    } catch(e) {}
    try {
        await runQuery(`ALTER TABLE sales ADD COLUMN status TEXT`);
    } catch(e) {}
    try {
        await runQuery(`ALTER TABLE sales ADD COLUMN discount REAL`);
    } catch(e) {}

    // Tabla de Créditos con store_id
    await runQuery(`
        CREATE TABLE IF NOT EXISTS credits (
            id TEXT,
            store_id TEXT,
            sale_id TEXT,
            client_id TEXT,
            amount_owed REAL,
            amount_paid REAL,
            date TEXT,
            status TEXT,
            PRIMARY KEY (id, store_id),
            FOREIGN KEY(sale_id, store_id) REFERENCES sales(id, store_id),
            FOREIGN KEY(client_id, store_id) REFERENCES clients(id, store_id)
        )
    `);
    try {
        await runQuery(`ALTER TABLE credits ADD COLUMN store_id TEXT`);
    } catch(e) {}

    // Tabla de Historial de Pagos de Créditos
    await runQuery(`
        CREATE TABLE IF NOT EXISTS credit_payments (
            id TEXT,
            store_id TEXT,
            credit_id TEXT,
            amount REAL,
            date TEXT,
            method TEXT,
            PRIMARY KEY (id, store_id),
            FOREIGN KEY(credit_id, store_id) REFERENCES credits(id, store_id)
        )
    `);
    try {
        await runQuery(`ALTER TABLE credit_payments ADD COLUMN store_id TEXT`);
    } catch(e) {}

    await runQuery(`
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT,
            store_id TEXT,
            value TEXT,
            PRIMARY KEY (key, store_id)
        )
    `);
    try {
        await runQuery(`ALTER TABLE settings ADD COLUMN store_id TEXT`);
    } catch(e) {}
    
    // Tabla de Arqueos de Caja
    await runQuery(`
        CREATE TABLE IF NOT EXISTS cashups (
            id TEXT,
            store_id TEXT,
            date TEXT,
            cash_usd REAL,
            cash_ves REAL,
            sales_usd REAL,
            sales_ves REAL,
            diff_usd REAL,
            cashier_name TEXT,
            notes TEXT,
            PRIMARY KEY (id, store_id)
        )
    `);
    try { await runQuery(`ALTER TABLE cashups ADD COLUMN store_id TEXT`); } catch(e) {}

    // Tabla de Movimientos/Merma
    await runQuery(`
        CREATE TABLE IF NOT EXISTS movements (
            id TEXT,
            store_id TEXT,
            product_id TEXT,
            product_name TEXT,
            type TEXT,
            quantity REAL,
            reason TEXT,
            date TEXT,
            timestamp INTEGER,
            cashier_name TEXT,
            PRIMARY KEY (id, store_id)
        )
    `);
    try { await runQuery(`ALTER TABLE movements ADD COLUMN store_id TEXT`); } catch(e) {}

    // Tabla de Transferencias de Stock
    await runQuery(`
        CREATE TABLE IF NOT EXISTS stock_transfers (
            id TEXT,
            store_id TEXT,
            from_store TEXT,
            to_store TEXT,
            product_id TEXT,
            product_name TEXT,
            quantity REAL,
            date TEXT,
            timestamp INTEGER,
            status TEXT,
            cashier_name TEXT,
            PRIMARY KEY (id, store_id)
        )
    `);
    try { await runQuery(`ALTER TABLE stock_transfers ADD COLUMN store_id TEXT`); } catch(e) {}

    // Tabla de Puntos de Lealtad
    await runQuery(`
        CREATE TABLE IF NOT EXISTS loyalty_points (
            client_id TEXT,
            store_id TEXT,
            points REAL,
            total_spent REAL,
            last_update TEXT,
            PRIMARY KEY (client_id, store_id)
        )
    `);
    try { await runQuery(`ALTER TABLE loyalty_points ADD COLUMN store_id TEXT`); } catch(e) {}

    // Tabla de Facturas Electrónicas
    await runQuery(`
        CREATE TABLE IF NOT EXISTS invoices (
            id TEXT,
            store_id TEXT,
            sale_id TEXT,
            client_email TEXT,
            sent_date TEXT,
            status TEXT,
            pdf_data TEXT,
            PRIMARY KEY (id, store_id)
        )
    `);
    try { await runQuery(`ALTER TABLE invoices ADD COLUMN store_id TEXT`); } catch(e) {}

    console.log('[DATABASE] Tablas inicializadas y migradas para Multi-Tenant.');
}

// API Exportada para el Frontend (Casi todos los métodos ahora requieren storeId)
const api = {
    // --- PRODUCTOS ---
    getProducts: (storeId) => getQuery(`SELECT * FROM products WHERE store_id = ? OR store_id IS NULL`, [storeId || '']),
    
    saveProduct: async (storeId, product) => {
        if (!product || !product.id) {
            console.error('[DATABASE] saveProduct invocado con producto inválido:', product);
            return { success: false, error: 'Producto inválido o sin ID' };
        }
        const sid = storeId || '';
        return runQuery(
            `INSERT OR REPLACE INTO products (id, store_id, name, category, priceUSD, priceVES, priceEUR, costPrice, stock, minStock, featured, flavors, expiryDate, description, img, barcode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                product.id,
                sid,
                product.name, 
                typeof product.category === 'object' ? JSON.stringify(product.category) : product.category, 
                product.priceUSD || product.price || 0, 
                product.priceVES || 0, 
                product.priceEUR || 0, 
                product.costPrice || 0, 
                product.stock || 0,
                product.minStock || 5,
                product.featured ? 1 : 0,
                JSON.stringify(product.flavors || []),
                product.expiryDate || '',
                product.description || '',
                product.img || '',
                product.barcode || ''
            ]
        );
    },
    
    saveProductsBulk: async (storeId, products) => {
        if (!products || !Array.isArray(products)) return;
        const sid = storeId || '';
        const CHUNK_SIZE = 50; 
        for (let i = 0; i < products.length; i += CHUNK_SIZE) {
            const chunk = products.slice(i, i + CHUNK_SIZE);
            const validChunk = chunk.filter(p => p && p.id);
            if (validChunk.length === 0) continue;
            
            const placeholders = validChunk.map(() => `(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).join(',');
            const values = [];
            validChunk.forEach(p => {
                values.push(
                    p.id,
                    sid,
                    p.name, 
                    typeof p.category === 'object' ? JSON.stringify(p.category) : p.category, 
                    p.priceUSD || p.price || 0, 
                    p.priceVES || 0, 
                    p.priceEUR || 0, 
                    p.costPrice || 0, 
                    p.stock || 0,
                    p.minStock || 5,
                    p.featured ? 1 : 0,
                    JSON.stringify(p.flavors || []),
                    p.expiryDate || '',
                    p.description || '',
                    p.img || '',
                    p.barcode || ''
                );
            });
            await runQuery(
                `INSERT OR REPLACE INTO products (id, store_id, name, category, priceUSD, priceVES, priceEUR, costPrice, stock, minStock, featured, flavors, expiryDate, description, img, barcode) VALUES ${placeholders}`,
                values
            );
        }
        return { success: true };
    },
    
    deleteProduct: (storeId, id) => runQuery(`DELETE FROM products WHERE id = ? AND store_id = ?`, [id, storeId || '']),

    // --- INGREDIENTES ---
    getIngredients: (storeId) => getQuery(`SELECT * FROM ingredients WHERE store_id = ? OR store_id IS NULL`, [storeId || '']),
    
    saveIngredient: (storeId, ingredient) => {
        const sid = storeId || '';
        return runQuery(
            `INSERT OR REPLACE INTO ingredients (id, store_id, name, unit, cost, stock, minStock) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [ingredient.id, sid, ingredient.name, ingredient.unit, ingredient.cost || 0, ingredient.stock || 0, ingredient.minStock || 0]
        );
    },
    
    deleteIngredient: (storeId, id) => runQuery(`DELETE FROM ingredients WHERE id = ? AND store_id = ?`, [id, storeId || '']),

    // --- RECETAS ---
    getRecipes: (storeId) => getQuery(`SELECT * FROM recipes WHERE store_id = ? OR store_id IS NULL`, [storeId || '']),
    
    saveRecipe: (storeId, recipe) => {
        const sid = storeId || '';
        return runQuery(
            `INSERT OR REPLACE INTO recipes (id, store_id, product_id, ingredient_id, quantity) VALUES (?, ?, ?, ?, ?)`,
            [recipe.id, sid, recipe.product_id, recipe.ingredient_id, recipe.quantity || 0]
        );
    },
    
    deleteRecipe: (storeId, id) => runQuery(`DELETE FROM recipes WHERE id = ? AND store_id = ?`, [id, storeId || '']),
    
    deleteRecipesByProduct: (storeId, productId) => runQuery(`DELETE FROM recipes WHERE product_id = ? AND store_id = ?`, [productId, storeId || '']),

    // --- CLIENTES ---
    getClients: (storeId) => getQuery(`SELECT * FROM clients WHERE store_id = ? OR store_id IS NULL`, [storeId || '']),
    
    saveClient: (storeId, client) => {
        const sid = storeId || '';
        return runQuery(
            `INSERT OR REPLACE INTO clients (id, store_id, document, name, phone, type) VALUES (?, ?, ?, ?, ?, ?)`,
            [client.id, sid, client.document, client.name, client.phone, client.type || 'cliente']
        );
    },

    // --- VENTAS ---
    getSales: (storeId, limit = 100) => getQuery(`
        SELECT s.*, cl.name as client_name, cl.document as client_document, cl.phone as client_phone 
        FROM sales s
        LEFT JOIN clients cl ON s.client_id = cl.id AND (s.store_id = cl.store_id OR cl.store_id IS NULL OR cl.store_id = '')
        WHERE s.store_id = ? OR s.store_id IS NULL OR s.store_id = '' 
        ORDER BY s.timestamp DESC 
        LIMIT ?
    `, [storeId || '', limit]),
    
    getSalesByDate: (storeId, startDate, endDate) => getQuery(`
        SELECT s.*, cl.name as client_name, cl.document as client_document, cl.phone as client_phone 
        FROM sales s
        LEFT JOIN clients cl ON s.client_id = cl.id AND (s.store_id = cl.store_id OR cl.store_id IS NULL OR cl.store_id = '')
        WHERE (s.store_id = ? OR s.store_id IS NULL OR s.store_id = '') AND s.timestamp >= ? AND s.timestamp <= ? 
        ORDER BY s.timestamp DESC
    `, [storeId || '', startDate, endDate]),
    
    saveSale: async (storeId, sale) => {
        const sid = storeId || '';
        await runQuery(
            `INSERT INTO sales (id, store_id, date, timestamp, total, method, client_id, items, pagoMovilRef, subtotal, tax, payments, cashier_name, status, discount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                sale.id, 
                sid, 
                sale.date, 
                sale.timestamp, 
                sale.totalUSD || sale.total || 0, 
                sale.method, 
                sale.clientId || null, 
                JSON.stringify(sale.items), 
                sale.pmDetails?.ref || sale.pagoMovilRef || null, 
                sale.subtotal || sale.totalUSD || sale.total || 0, 
                sale.tax || 0, 
                sale.payments || null, 
                sale.cashierName || 'Cajero',
                sale.status || 'paid',
                sale.discount || 0
            ]
        );

        if (sale.method === 'Crédito' || sale.method === 'Fiado') {
            const creditId = 'cred_' + Date.now();
            await runQuery(
                `INSERT INTO credits (id, store_id, sale_id, client_id, amount_owed, amount_paid, date, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [creditId, sid, sale.id, sale.clientId, sale.totalUSD || sale.total, 0, new Date().toISOString(), 'PENDING']
            );
        }
        return sale;
    },

    voidSale: async (storeId, saleId) => {
        const sid = storeId || '';
        await runQuery(`UPDATE sales SET status = 'void' WHERE id = ? AND (store_id = ? OR store_id IS NULL OR store_id = '')`, [saleId, sid]);
        await runQuery(`UPDATE credits SET status = 'VOID' WHERE sale_id = ? AND (store_id = ? OR store_id IS NULL OR store_id = '')`, [saleId, sid]);
        return { success: true };
    },

    // --- CRÉDITOS ---
    getCredits: async (storeId) => {
        return getQuery(`
            SELECT c.*, cl.name as client_name, cl.document as client_document, s.total as sale_total, s.id as sale_ticket
            FROM credits c
            LEFT JOIN clients cl ON c.client_id = cl.id AND c.store_id = cl.store_id
            LEFT JOIN sales s ON c.sale_id = s.id AND c.store_id = s.store_id
            WHERE (c.store_id = ? OR c.store_id IS NULL) AND c.status = 'PENDING'
            ORDER BY c.date DESC
        `, [storeId || '']);
    },
    
    addCreditPayment: async (storeId, creditId, amount, method) => {
        const sid = storeId || '';
        const paymentId = 'pay_' + Date.now();
        await runQuery(
            `INSERT INTO credit_payments (id, store_id, credit_id, amount, date, method) VALUES (?, ?, ?, ?, ?, ?)`,
            [paymentId, sid, creditId, amount, new Date().toISOString(), method]
        );
        
        await runQuery(`UPDATE credits SET amount_paid = amount_paid + ? WHERE id = ? AND store_id = ?`, [amount, creditId, sid]);
        
        const credit = (await getQuery(`SELECT amount_owed, amount_paid FROM credits WHERE id = ? AND store_id = ?`, [creditId, sid]))[0];
        if (credit && credit.amount_paid >= credit.amount_owed) {
            await runQuery(`UPDATE credits SET status = 'PAID' WHERE id = ? AND store_id = ?`, [creditId, sid]);
        }
    },

    // --- MIGRACIÓN ---
    migrateData: async (storeId, data) => {
        const sid = storeId || '';
        console.log(`[DATABASE] Iniciando migración para tenant: ${sid}`);
        if (data.products) {
            for (const p of data.products) {
                const pUSD = p.priceUSD || (p.price && !p.priceVES ? p.price : 0);
                const pVES = p.priceVES || (p.price && p.priceVES ? p.price : 0);
                await api.saveProduct(sid, {
                    id: p.id, name: p.name, category: p.category || 'Otros',
                    priceUSD: pUSD, priceVES: pVES, costPrice: p.costPrice || 0,
                    stock: p.stock || 0, img: p.img || ''
                });
            }
        }
        if (data.clients) {
            for (const c of data.clients) {
                await api.saveClient(sid, c);
            }
        }
        return true;
    },

    // --- CASHUPS (ARQUEOS) ---
    getCashups: (storeId) => getQuery(`SELECT * FROM cashups WHERE store_id = ? ORDER BY date DESC`, [storeId || '']),

    saveCashup: (storeId, cashup) => {
        const sid = storeId || '';
        return runQuery(
            `INSERT OR REPLACE INTO cashups (id, store_id, date, cash_usd, cash_ves, sales_usd, sales_ves, diff_usd, cashier_name, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [cashup.id, sid, cashup.date, cashup.cash_usd, cashup.cash_ves, cashup.sales_usd, cashup.sales_ves, cashup.diff_usd, cashup.cashier_name, cashup.notes || '']
        );
    },

    // --- MOVEMENTS ---
    getMovements: (storeId, startDate, endDate, type) => {
        let sql = `SELECT * FROM movements WHERE store_id = ?`;
        let params = [storeId || ''];
        if (type && type !== 'all') { sql += ` AND type = ?`; params.push(type); }
        if (startDate) { sql += ` AND date >= ?`; params.push(startDate); }
        if (endDate) { sql += ` AND date <= ?`; params.push(endDate); }
        sql += ` ORDER BY timestamp DESC LIMIT 500`;
        return getQuery(sql, params);
    },

    saveMovement: (storeId, movement) => {
        const sid = storeId || '';
        return runQuery(
            `INSERT INTO movements (id, store_id, product_id, product_name, type, quantity, reason, date, timestamp, cashier_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [movement.id, sid, movement.product_id, movement.product_name, movement.type, movement.quantity, movement.reason, movement.date, movement.timestamp, movement.cashier_name]
        );
    },

    // --- STOCK TRANSFERS ---
    getTransfers: (storeId) => getQuery(`SELECT * FROM stock_transfers WHERE store_id = ? OR from_store = ? OR to_store = ? ORDER BY timestamp DESC LIMIT 200`, [storeId || '', storeId || '', storeId || '']),

    saveTransfer: (storeId, transfer) => {
        const sid = storeId || '';
        return runQuery(
            `INSERT INTO stock_transfers (id, store_id, from_store, to_store, product_id, product_name, quantity, date, timestamp, status, cashier_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [transfer.id, sid, transfer.from_store, transfer.to_store, transfer.product_id, transfer.product_name, transfer.quantity, transfer.date, transfer.timestamp, transfer.status || 'PENDING', transfer.cashier_name]
        );
    },

    completeTransfer: (storeId, transferId) => runQuery(`UPDATE stock_transfers SET status = 'COMPLETED' WHERE id = ? AND store_id = ?`, [transferId, storeId || '']),

    // --- LOYALTY POINTS ---
    getLoyaltyPoints: (storeId) => getQuery(`SELECT lp.*, cl.name as client_name, cl.document as client_document FROM loyalty_points lp LEFT JOIN clients cl ON lp.client_id = cl.id AND (lp.store_id = cl.store_id OR cl.store_id IS NULL OR cl.store_id = '') WHERE lp.store_id = ? ORDER BY lp.points DESC`, [storeId || '']),

    getClientLoyalty: (storeId, clientId) => {
        const sid = storeId || '';
        return getQuery(`SELECT * FROM loyalty_points WHERE client_id = ? AND store_id = ?`, [clientId, sid]).then(r => r[0] || null);
    },

    saveLoyaltyPoints: (storeId, lp) => {
        const sid = storeId || '';
        return runQuery(
            `INSERT OR REPLACE INTO loyalty_points (client_id, store_id, points, total_spent, last_update) VALUES (?, ?, ?, ?, ?)`,
            [lp.client_id, sid, lp.points || 0, lp.total_spent || 0, lp.last_update || new Date().toISOString()]
        );
    },

    addLoyaltyPoints: (storeId, clientId, points, spent) => {
        const sid = storeId || '';
        return runQuery(
            `INSERT INTO loyalty_points (client_id, store_id, points, total_spent, last_update) VALUES (?, ?, ?, ?, ?) ON CONFLICT(client_id, store_id) DO UPDATE SET points = points + ?, total_spent = total_spent + ?, last_update = ?`,
            [clientId, sid, points, spent, new Date().toISOString(), points, spent, new Date().toISOString()]
        );
    },

    redeemLoyaltyPoints: (storeId, clientId, points) => {
        const sid = storeId || '';
        return runQuery(`UPDATE loyalty_points SET points = points - ? WHERE client_id = ? AND store_id = ? AND points >= ?`, [points, clientId, sid, points]);
    },

    // --- INVOICES ---
    getInvoices: (storeId) => getQuery(`SELECT i.*, s.total, s.date as sale_date, cl.name as client_name FROM invoices i LEFT JOIN sales s ON i.sale_id = s.id AND (i.store_id = s.store_id OR s.store_id IS NULL OR s.store_id = '') LEFT JOIN clients cl ON s.client_id = cl.id AND (s.store_id = cl.store_id OR cl.store_id IS NULL OR cl.store_id = '') WHERE i.store_id = ? ORDER BY i.sent_date DESC`, [storeId || '']),

    saveInvoice: (storeId, invoice) => {
        const sid = storeId || '';
        return runQuery(
            `INSERT INTO invoices (id, store_id, sale_id, client_email, sent_date, status, pdf_data) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [invoice.id, sid, invoice.sale_id, invoice.client_email, invoice.sent_date, invoice.status || 'SENT', invoice.pdf_data || '']
        );
    },
};

module.exports = { initDatabase, api };
