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
    // Tabla de Productos
    await runQuery(`
        CREATE TABLE IF NOT EXISTS products (
            id TEXT PRIMARY KEY,
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
            img TEXT
        )
    `);

    // Tabla de Clientes
    await runQuery(`
        CREATE TABLE IF NOT EXISTS clients (
            id TEXT PRIMARY KEY,
            document TEXT,
            name TEXT,
            phone TEXT
        )
    `);

    // Tabla de Ventas
    await runQuery(`
        CREATE TABLE IF NOT EXISTS sales (
            id TEXT PRIMARY KEY,
            date TEXT,
            timestamp INTEGER,
            total REAL,
            method TEXT,
            client_id TEXT,
            items TEXT,
            pagoMovilRef TEXT,
            subtotal REAL,
            tax REAL
        )
    `);

    // Tabla de Créditos (Fiaos)
    await runQuery(`
        CREATE TABLE IF NOT EXISTS credits (
            id TEXT PRIMARY KEY,
            sale_id TEXT,
            client_id TEXT,
            amount_owed REAL,
            amount_paid REAL,
            date TEXT,
            status TEXT,
            FOREIGN KEY(sale_id) REFERENCES sales(id),
            FOREIGN KEY(client_id) REFERENCES clients(id)
        )
    `);

    // Tabla de Historial de Pagos de Créditos
    await runQuery(`
        CREATE TABLE IF NOT EXISTS credit_payments (
            id TEXT PRIMARY KEY,
            credit_id TEXT,
            amount REAL,
            date TEXT,
            method TEXT,
            FOREIGN KEY(credit_id) REFERENCES credits(id)
        )
    `);

    // Gastos y Categorías se pueden mantener en JSON para no sobrecomplicar o usar una tabla simple de key-value
    await runQuery(`
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    `);
    
    console.log('[DATABASE] Tablas inicializadas.');
}

// API Exportada para el Frontend
const api = {
    // --- PRODUCTOS ---
    getProducts: () => getQuery(`SELECT * FROM products`),
    saveProduct: async (product) => {
        return runQuery(
            `INSERT OR REPLACE INTO products (id, name, category, priceUSD, priceVES, priceEUR, costPrice, stock, minStock, featured, flavors, expiryDate, description, img) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                product.id, 
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
                product.img || ''
            ]
        );
    },
    saveProductsBulk: async (products) => {
        if (!products || !Array.isArray(products)) return;
        
        // SQLite has a limit on the number of host parameters (999 by default). 
        // 14 columns per product means we can save about 70 products per chunk.
        const CHUNK_SIZE = 50; 
        for (let i = 0; i < products.length; i += CHUNK_SIZE) {
            const chunk = products.slice(i, i + CHUNK_SIZE);
            const placeholders = chunk.map(() => `(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).join(',');
            const values = [];
            chunk.forEach(p => {
                values.push(
                    p.id, 
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
                    p.img || ''
                );
            });
            await runQuery(
                `INSERT OR REPLACE INTO products (id, name, category, priceUSD, priceVES, priceEUR, costPrice, stock, minStock, featured, flavors, expiryDate, description, img) VALUES ${placeholders}`,
                values
            );
        }
        return { success: true };
    },
    deleteProduct: (id) => runQuery(`DELETE FROM products WHERE id = ?`, [id]),

    // --- CLIENTES ---
    getClients: () => getQuery(`SELECT * FROM clients`),
    saveClient: (client) => {
        return runQuery(
            `INSERT OR REPLACE INTO clients (id, document, name, phone) VALUES (?, ?, ?, ?)`,
            [client.id, client.document, client.name, client.phone]
        );
    },

    // --- VENTAS ---
    getSales: (limit = 100) => getQuery(`SELECT * FROM sales ORDER BY timestamp DESC LIMIT ?`, [limit]),
    getSalesByDate: (startDate, endDate) => getQuery(`SELECT * FROM sales WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp DESC`, [startDate, endDate]),
    saveSale: async (sale) => {
        // Guardar venta
        await runQuery(
            `INSERT INTO sales (id, date, timestamp, total, method, client_id, items, pagoMovilRef, subtotal, tax) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [sale.id, sale.date, sale.timestamp, sale.totalUSD || sale.total || 0, sale.method, sale.clientId || null, JSON.stringify(sale.items), sale.pmDetails?.ref || sale.pagoMovilRef || null, sale.totalUSD || sale.total || 0, sale.tax || 0]
        );

        // Si es a crédito, registrar en la tabla credits
        if (sale.method === 'Crédito' || sale.method === 'Fiado') {
            const creditId = 'cred_' + Date.now();
            await runQuery(
                `INSERT INTO credits (id, sale_id, client_id, amount_owed, amount_paid, date, status) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [creditId, sale.id, sale.clientId, sale.totalUSD || sale.total, 0, new Date().toISOString(), 'PENDING']
            );
        }

        return sale;
    },

    // --- CRÉDITOS ---
    getCredits: async () => {
        // Retornar créditos junto con el nombre del cliente y detalles de la venta
        return getQuery(`
            SELECT c.*, cl.name as client_name, cl.document as client_document, s.total as sale_total, s.id as sale_ticket
            FROM credits c
            LEFT JOIN clients cl ON c.client_id = cl.id
            LEFT JOIN sales s ON c.sale_id = s.id
            WHERE c.status = 'PENDING'
            ORDER BY c.date DESC
        `);
    },
    addCreditPayment: async (creditId, amount, method) => {
        const paymentId = 'pay_' + Date.now();
        await runQuery(
            `INSERT INTO credit_payments (id, credit_id, amount, date, method) VALUES (?, ?, ?, ?, ?)`,
            [paymentId, creditId, amount, new Date().toISOString(), method]
        );
        
        await runQuery(`UPDATE credits SET amount_paid = amount_paid + ? WHERE id = ?`, [amount, creditId]);
        
        // Verificar si se completó el pago
        const credit = (await getQuery(`SELECT amount_owed, amount_paid FROM credits WHERE id = ?`, [creditId]))[0];
        if (credit && credit.amount_paid >= credit.amount_owed) {
            await runQuery(`UPDATE credits SET status = 'PAID' WHERE id = ?`, [creditId]);
        }
    },

    // --- MIGRACIÓN (Para cargar datos del localStorage a SQLite una sola vez) ---
    migrateData: async (data) => {
        console.log('[DATABASE] Iniciando migración de localStorage...');
        if (data.products) {
            for (const p of data.products) {
                // Adaptar campos antiguos si los hay
                const pUSD = p.priceUSD || (p.price && !p.priceVES ? p.price : 0);
                const pVES = p.priceVES || (p.price && p.priceVES ? p.price : 0);
                await api.saveProduct({
                    id: p.id, name: p.name, category: p.category || 'Otros',
                    priceUSD: pUSD, priceVES: pVES, costPrice: p.costPrice || 0,
                    stock: p.stock || 0, img: p.img || ''
                });
            }
        }
        if (data.clients) {
            for (const c of data.clients) {
                await api.saveClient(c);
            }
        }
        return true;
    }
};

module.exports = { initDatabase, api };
