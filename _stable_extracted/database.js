const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

let db;

function initDatabase(userDataPath) {
    return new Promise((resolve, reject) => {
        const dbDir = path.join(userDataPath, 'database');
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }
        
        const dbPath = path.join(dbDir, 'freshpos.sqlite');
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
    getSales: (storeId, limit = 100) => getQuery(`SELECT * FROM sales WHERE store_id = ? OR store_id IS NULL ORDER BY timestamp DESC LIMIT ?`, [storeId || '', limit]),
    
    getSalesByDate: (storeId, startDate, endDate) => getQuery(`SELECT * FROM sales WHERE (store_id = ? OR store_id IS NULL) AND timestamp >= ? AND timestamp <= ? ORDER BY timestamp DESC`, [storeId || '', startDate, endDate]),
    
    saveSale: async (storeId, sale) => {
        const sid = storeId || '';
        await runQuery(
            `INSERT INTO sales (id, store_id, date, timestamp, total, method, client_id, items, pagoMovilRef, subtotal, tax) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [sale.id, sid, sale.date, sale.timestamp, sale.totalUSD || sale.total || 0, sale.method, sale.clientId || null, JSON.stringify(sale.items), sale.pmDetails?.ref || sale.pagoMovilRef || null, sale.totalUSD || sale.total || 0, sale.tax || 0]
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
    }
};

module.exports = { initDatabase, api };
