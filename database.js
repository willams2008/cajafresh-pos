const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

let db;
let _dbPath = '';

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
        _dbPath = dbPath;
        
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
        'barcode TEXT',
        'flavorBarcodes TEXT',
        'presentations TEXT',
        'composite TEXT',
        'variants TEXT'
    ];
    for (const col of productCols) {
        try {
            await runQuery(`ALTER TABLE products ADD COLUMN ${col}`);
        } catch(e) {}
    }
    try { await runQuery(`ALTER TABLE products ADD COLUMN points INTEGER DEFAULT 0`); } catch(e) {}
    try { await runQuery(`ALTER TABLE products ADD COLUMN deleted_at TEXT`); } catch(e) {}

    // Tabla de Metadatos (flags persistentes tipo key-value)
    await runQuery(`
        CREATE TABLE IF NOT EXISTS meta (
            key TEXT,
            store_id TEXT,
            value TEXT,
            PRIMARY KEY (key, store_id)
        )
    `);

    // Tabla de Historial de Cambios de Productos
    await runQuery(`
        CREATE TABLE IF NOT EXISTS product_changes (
            id TEXT,
            store_id TEXT,
            product_id TEXT,
            field TEXT,
            old_value TEXT,
            new_value TEXT,
            action TEXT,
            cashier_name TEXT,
            timestamp TEXT,
            PRIMARY KEY (id, store_id)
        )
    `);

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
    try { await runQuery(`ALTER TABLE cashups ADD COLUMN opening_usd REAL DEFAULT 0`); } catch(e) {}
    try { await runQuery(`ALTER TABLE cashups ADD COLUMN opening_ves REAL DEFAULT 0`); } catch(e) {}
    try { await runQuery(`ALTER TABLE cashups ADD COLUMN sales_pago_movil REAL DEFAULT 0`); } catch(e) {}
    try { await runQuery(`ALTER TABLE cashups ADD COLUMN sales_transfer REAL DEFAULT 0`); } catch(e) {}
    try { await runQuery(`ALTER TABLE cashups ADD COLUMN sales_card REAL DEFAULT 0`); } catch(e) {}
    try { await runQuery(`ALTER TABLE cashups ADD COLUMN sales_eur REAL DEFAULT 0`); } catch(e) {}
    try { await runQuery(`ALTER TABLE cashups ADD COLUMN expenses_total REAL DEFAULT 0`); } catch(e) {}
    try { await runQuery(`ALTER TABLE cashups ADD COLUMN transaction_count INTEGER DEFAULT 0`); } catch(e) {}
    try { await runQuery(`ALTER TABLE cashups ADD COLUMN counted_usd REAL DEFAULT 0`); } catch(e) {}
    try { await runQuery(`ALTER TABLE cashups ADD COLUMN counted_ves REAL DEFAULT 0`); } catch(e) {}
    try { await runQuery(`ALTER TABLE cashups ADD COLUMN diff_ves REAL DEFAULT 0`); } catch(e) {}
    try { await runQuery(`ALTER TABLE cashups ADD COLUMN status TEXT DEFAULT 'open'`); } catch(e) {}

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

    // Tabla de Órdenes de Compra (Kiosko → Almacén)
    await runQuery(`
        CREATE TABLE IF NOT EXISTS purchase_orders (
            id TEXT,
            store_id TEXT,
            order_type TEXT DEFAULT 'purchase',
            from_store TEXT,
            to_store TEXT,
            status TEXT DEFAULT 'PENDING',
            items TEXT,
            notes TEXT,
            total_cost REAL DEFAULT 0,
            date TEXT,
            timestamp INTEGER,
            created_by TEXT,
            approved_by TEXT,
            received_date TEXT,
            PRIMARY KEY (id, store_id)
        )
    `);
    try { await runQuery(`ALTER TABLE purchase_orders ADD COLUMN store_id TEXT`); } catch(e) {}

    // Tabla de Items de Órdenes de Compra
    await runQuery(`
        CREATE TABLE IF NOT EXISTS po_items (
            id TEXT,
            store_id TEXT,
            po_id TEXT,
            product_id TEXT,
            product_name TEXT,
            quantity REAL,
            received_qty REAL DEFAULT 0,
            cost_price REAL DEFAULT 0,
            PRIMARY KEY (id, store_id)
        )
    `);
    try { await runQuery(`ALTER TABLE po_items ADD COLUMN store_id TEXT`); } catch(e) {}

    // Migración: añadir campos faltantes a stock_transfers
    try { await runQuery(`ALTER TABLE stock_transfers ADD COLUMN notes TEXT`); } catch(e) {}
    try { await runQuery(`ALTER TABLE stock_transfers ADD COLUMN po_id TEXT`); } catch(e) {}

    // Tabla de Usuarios
    await runQuery(`
        CREATE TABLE IF NOT EXISTS users (
            id TEXT,
            store_id TEXT,
            username TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            salt TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'cashier',
            name TEXT NOT NULL,
            active INTEGER DEFAULT 1,
            created_at TEXT,
            last_login TEXT,
            PRIMARY KEY (id, store_id)
        )
    `);

    try { await runQuery(`ALTER TABLE users ADD COLUMN created_at TEXT`); } catch(e) {}
    try { await runQuery(`ALTER TABLE users ADD COLUMN last_login TEXT`); } catch(e) {}
    try { await runQuery(`ALTER TABLE users ADD COLUMN phone TEXT`); } catch(e) {}
    try { await runQuery(`ALTER TABLE users ADD COLUMN document TEXT`); } catch(e) {}
    try { await runQuery(`ALTER TABLE users ADD COLUMN photo TEXT`); } catch(e) {}

    console.log('[DATABASE] Tablas inicializadas y migradas para Multi-Tenant.');
}

// API Exportada para el Frontend (Casi todos los métodos ahora requieren storeId)
const api = {
    // --- PRODUCTOS ---
    getProducts: (storeId) => getQuery(`SELECT * FROM products WHERE store_id = ?`, [storeId || '']),
    getActiveProducts: (storeId) => getQuery(`SELECT * FROM products WHERE store_id = ? AND (deleted_at IS NULL OR deleted_at = '')`, [storeId || '']),

    getProductById: (storeId, productId) => {
        const rows = db.prepare ? null : null;
        return getQuery(`SELECT * FROM products WHERE id = ? AND store_id = ?`, [productId, storeId || '']).then(r => r[0] || null);
    },

    logProductChange: (storeId, change) => {
        const sid = storeId || '';
        return runQuery(
            `INSERT INTO product_changes (id, store_id, product_id, field, old_value, new_value, action, cashier_name, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [change.id, sid, change.product_id, change.field, change.old_value, change.new_value, change.action, change.cashier_name, change.timestamp]
        );
    },

    getProductChanges: (storeId, productId, limit = 10) => {
        let sql = `SELECT * FROM product_changes WHERE store_id = ?`;
        let params = [storeId || ''];
        if (productId) { sql += ` AND product_id = ?`; params.push(productId); }
        sql += ` ORDER BY timestamp DESC LIMIT ?`;
        params.push(limit);
        return getQuery(sql, params);
    },

    setMeta: (storeId, key, value) => {
        const sid = storeId || '';
        return runQuery(
            `INSERT OR REPLACE INTO meta (key, store_id, value) VALUES (?, ?, ?)`,
            [key, sid, String(value)]
        );
    },

    getMeta: (storeId, key) => {
        const sid = storeId || '';
        return getQuery(`SELECT value FROM meta WHERE key = ? AND store_id = ?`, [key, sid]).then(r => r[0]?.value || null);
    },

    saveProduct: async (storeId, product) => {
        if (!product || !product.id) {
            console.error('[DATABASE] saveProduct invocado con producto inválido:', product);
            return { success: false, error: 'Producto inválido o sin ID' };
        }
        const sid = storeId || '';
        const cashier = product._cashier || 'system';
        const now = new Date().toISOString();

        // Detect changes by comparing with existing
        let existing = null;
        try {
            const rows = await getQuery(`SELECT * FROM products WHERE id = ? AND store_id = ?`, [product.id, sid]);
            existing = rows[0] || null;
        } catch(e) {}

        const fieldsToTrack = ['name', 'category', 'priceUSD', 'priceVES', 'priceEUR', 'costPrice', 'stock', 'minStock', 'featured'];
        const changes = [];

        if (existing) {
            for (const field of fieldsToTrack) {
                let oldVal = existing[field];
                let newVal = product[field];
                if (field === 'category' && typeof oldVal === 'string') { try { oldVal = JSON.parse(oldVal); } catch(e) {} }
                if (field === 'featured') { oldVal = existing[field] ? 1 : 0; newVal = product[field] ? 1 : 0; }
                const oldStr = String(oldVal ?? '');
                const newStr = String(newVal ?? '');
                if (oldStr !== newStr) {
                    changes.push({ field, old_value: oldStr, new_value: newStr });
                }
            }
        } else {
            changes.push({ field: '*', old_value: '', new_value: 'created', action: 'create' });
        }

        const result = await runQuery(
            `INSERT OR REPLACE INTO products (id, store_id, name, category, priceUSD, priceVES, priceEUR, costPrice, stock, minStock, featured, flavors, expiryDate, description, img, barcode, flavorBarcodes, presentations, composite, variants, points) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                product.id,
                sid,
                product.name, 
                typeof product.category === 'object' ? JSON.stringify(product.category) : product.category, 
                product.priceUSD ?? product.price ?? 0, 
                product.priceVES ?? 0, 
                product.priceEUR ?? 0, 
                product.costPrice ?? 0, 
                product.stock ?? 0,
                product.minStock ?? 5,
                product.featured ? 1 : 0,
                JSON.stringify(product.flavors ?? []),
                product.expiryDate ?? '',
                product.description ?? '',
                product.img ?? '',
                product.barcode ?? '',
                JSON.stringify(product.flavorBarcodes ?? {}),
                JSON.stringify(product.presentations ?? []),
                JSON.stringify(product.composite ?? { enabled: false, items: [] }),
                JSON.stringify(product.variants ?? []),
                product.points ?? 0
            ]
        );

        // Log changes asynchronously (don't block the save)
        if (changes.length > 0) {
            const action = existing ? 'update' : 'create';
            for (const c of changes) {
                const changeId = 'chg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
                runQuery(
                    `INSERT INTO product_changes (id, store_id, product_id, field, old_value, new_value, action, cashier_name, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [changeId, sid, product.id, c.field, c.old_value, c.new_value, c.action || action, cashier, now]
                ).catch(e => console.error('[DB] Error logueando cambio:', e));
            }
        }

        return result;
    },
    
    saveProductsBulk: async (storeId, products) => {
        if (!products || !Array.isArray(products)) return;
        const sid = storeId || '';
        const now = new Date().toISOString();
        const cashier = products[0]?._cashier || 'system';
        const CHUNK_SIZE = 50;

        // Pre-fetch existing products for change detection
        const ids = products.filter(p => p && p.id).map(p => p.id);
        let existingMap = {};
        if (ids.length > 0) {
            try {
                const placeholders = ids.map(() => '?').join(',');
                const rows = await getQuery(`SELECT * FROM products WHERE id IN (${placeholders}) AND store_id = ?`, [...ids, sid]);
                rows.forEach(r => { existingMap[r.id] = r; });
            } catch(e) {}
        }

        const batchChanges = [];
        for (let i = 0; i < products.length; i += CHUNK_SIZE) {
            const chunk = products.slice(i, i + CHUNK_SIZE);
            const validChunk = chunk.filter(p => p && p.id);
            if (validChunk.length === 0) continue;

            const values = [];
            validChunk.forEach(p => {
                values.push(
                    p.id, sid,
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
                    p.barcode || '',
                    JSON.stringify(p.flavorBarcodes || {}),
                    JSON.stringify(p.presentations || []),
                    JSON.stringify(p.composite || { enabled: false, items: [] }),
                    JSON.stringify(p.variants || []),
                    p.points || 0
                );

                // Detect changes
                const existing = existingMap[p.id];
                const tracked = ['name', 'priceUSD', 'priceVES', 'priceEUR', 'costPrice', 'stock', 'minStock', 'featured'];
                for (const field of tracked) {
                    const oldVal = existing ? String(existing[field] ?? '') : '';
                    const newVal = String(p[field] ?? '');
                    if (oldVal !== newVal) {
                        batchChanges.push({
                            id: 'chg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                            store_id: sid,
                            product_id: p.id,
                            field,
                            old_value: oldVal,
                            new_value: newVal,
                            action: existing ? 'update' : 'create',
                            cashier_name: cashier,
                            timestamp: now
                        });
                    }
                }
            });

            const ph = validChunk.map(() => `(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).join(',');
            await runQuery(
                `INSERT OR REPLACE INTO products (id, store_id, name, category, priceUSD, priceVES, priceEUR, costPrice, stock, minStock, featured, flavors, expiryDate, description, img, barcode, flavorBarcodes, presentations, composite, variants, points) VALUES ${ph}`,
                values
            );
        }

        // Log all detected changes asynchronously
        if (batchChanges.length > 0) {
            const chValues = [];
            batchChanges.forEach(c => {
                chValues.push(c.id, c.store_id, c.product_id, c.field, c.old_value, c.new_value, c.action, c.cashier_name, c.timestamp);
            });
            const ph2 = batchChanges.map(() => `(?, ?, ?, ?, ?, ?, ?, ?, ?)`).join(',');
            runQuery(
                `INSERT INTO product_changes (id, store_id, product_id, field, old_value, new_value, action, cashier_name, timestamp) VALUES ${ph2}`,
                chValues
            ).catch(e => console.error('[DB] Error logueando cambios batch:', e));
        }

        return { success: true };
    },
    
    deleteProduct: (storeId, id, cashier_name) => {
        const sid = storeId || '';
        const now = new Date().toISOString();
        const cashier = cashier_name || 'system';
        // Log the deletion
        const changeId = 'chg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        runQuery(
            `INSERT INTO product_changes (id, store_id, product_id, field, old_value, new_value, action, cashier_name, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [changeId, sid, id, '*', 'active', 'deleted', 'delete', cashier, now]
        ).catch(e => {});
        return runQuery(`UPDATE products SET deleted_at = ? WHERE id = ? AND store_id = ?`, [now, id, sid]);
    },

    restoreProduct: (storeId, id, cashier_name) => {
        const sid = storeId || '';
        const now = new Date().toISOString();
        const cashier = cashier_name || 'system';
        const changeId = 'chg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        runQuery(
            `INSERT INTO product_changes (id, store_id, product_id, field, old_value, new_value, action, cashier_name, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [changeId, sid, id, '*', 'deleted', 'active', 'restore', cashier, now]
        ).catch(e => {});
        return runQuery(`UPDATE products SET deleted_at = NULL WHERE id = ? AND store_id = ?`, [id, sid]);
    },

    getDeletedProducts: (storeId) => getQuery(`SELECT * FROM products WHERE store_id = ? AND deleted_at IS NOT NULL AND deleted_at != '' ORDER BY deleted_at DESC`, [storeId || '']),

    deleteProductPermanent: (storeId, id) => runQuery(`DELETE FROM products WHERE id = ? AND store_id = ?`, [id, storeId || '']),
    deleteAllProducts: (storeId) => runQuery(`UPDATE products SET deleted_at = ? WHERE store_id = ? AND (deleted_at IS NULL OR deleted_at = '')`, [new Date().toISOString(), storeId || '']),

    // --- INGREDIENTES ---
    getIngredients: (storeId) => getQuery(`SELECT * FROM ingredients WHERE store_id = ?`, [storeId || '']),
    
    saveIngredient: (storeId, ingredient) => {
        const sid = storeId || '';
        return runQuery(
            `INSERT OR REPLACE INTO ingredients (id, store_id, name, unit, cost, stock, minStock) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [ingredient.id, sid, ingredient.name, ingredient.unit, ingredient.cost || 0, ingredient.stock || 0, ingredient.minStock || 0]
        );
    },
    
    deleteIngredient: (storeId, id) => runQuery(`DELETE FROM ingredients WHERE id = ? AND store_id = ?`, [id, storeId || '']),

    // --- RECETAS ---
    getRecipes: (storeId) => getQuery(`SELECT * FROM recipes WHERE store_id = ?`, [storeId || '']),
    
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
    getClients: (storeId) => getQuery(`SELECT * FROM clients WHERE store_id = ?`, [storeId || '']),
    
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
        LEFT JOIN clients cl ON s.client_id = cl.id AND s.store_id = cl.store_id
        WHERE s.store_id = ?
        ORDER BY s.timestamp DESC 
        LIMIT ?
    `, [storeId || '', limit]),
    
    getSalesByDate: (storeId, startDate, endDate) => getQuery(`
        SELECT s.*, cl.name as client_name, cl.document as client_document, cl.phone as client_phone 
        FROM sales s
        LEFT JOIN clients cl ON s.client_id = cl.id AND s.store_id = cl.store_id
        WHERE s.store_id = ? AND s.timestamp >= ? AND s.timestamp <= ? 
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
        await runQuery(`UPDATE sales SET status = 'void' WHERE id = ? AND store_id = ?`, [saleId, sid]);
        await runQuery(`UPDATE credits SET status = 'VOID' WHERE sale_id = ? AND store_id = ?`, [saleId, sid]);
        return { success: true };
    },

    // --- USUARIOS ---
    getUsers: async (storeId) => {
        if (storeId) { return getQuery(`SELECT id, store_id, username, role, name, phone, document, photo, active, created_at, last_login FROM users WHERE store_id = ? ORDER BY name ASC`, [storeId]); }
        return getQuery(`SELECT id, store_id, username, role, name, phone, document, photo, active, created_at, last_login FROM users ORDER BY name ASC`);
    },
    getUser: async (storeId, username) => {
        return getQuery(`SELECT * FROM users WHERE store_id = ? AND username = ? AND active = 1`, [storeId || '', username]).then(r => r[0] || null);
    },
    getUserById: async (storeId, userId) => {
        return getQuery(`SELECT id, store_id, username, role, name, phone, document, photo, active, created_at, last_login FROM users WHERE store_id = ? AND id = ?`, [storeId || '', userId]).then(r => r[0] || null);
    },
    saveUser: async (storeId, user) => {
        const sid = storeId || '';
        return runQuery(
            `INSERT OR REPLACE INTO users (id, store_id, username, password_hash, salt, role, name, phone, document, photo, active, created_at, last_login) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [user.id, sid, user.username, user.password_hash, user.salt, user.role, user.name, user.phone || '', user.document || '', user.photo || '', user.active ? 1 : 0, user.created_at || new Date().toISOString(), user.last_login || null]
        );
    },
    deleteUser: async (storeId, userId) => {
        return runQuery(`DELETE FROM users WHERE id = ? AND store_id = ?`, [userId, storeId || '']);
    },
    updateUserLastLogin: async (storeId, userId) => {
        return runQuery(`UPDATE users SET last_login = ? WHERE id = ? AND store_id = ?`, [new Date().toISOString(), userId, storeId || '']);
    },

    // --- CRÉDITOS ---
    getCredits: async (storeId) => {
        return getQuery(`
            SELECT c.*, cl.name as client_name, cl.document as client_document, s.total as sale_total, s.id as sale_ticket, s.items as sale_items
            FROM credits c
            LEFT JOIN clients cl ON c.client_id = cl.id AND c.store_id = cl.store_id
            LEFT JOIN sales s ON c.sale_id = s.id AND c.store_id = s.store_id
            WHERE c.store_id = ? AND c.status = 'PENDING'
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
        // Backup automático antes de migrar
        try {
            const dbDir2 = _dbPath ? path.dirname(_dbPath) : '';
            if (_dbPath && fs.existsSync(_dbPath)) {
                const backupDir = path.join(dbDir2, 'backups');
                if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
                const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
                const backupPath = path.join(backupDir, `freshpos_pre_migrate_${dateStr}.sqlite`);
                fs.copyFileSync(_dbPath, backupPath);
                console.log(`[DATABASE] Backup pre-migración creado: ${backupPath}`);
                const files = fs.readdirSync(backupDir).filter(f => f.startsWith('freshpos_pre_migrate_'));
                if (files.length > 5) {
                    files.sort().slice(0, files.length - 5).forEach(f => {
                        try { fs.unlinkSync(path.join(backupDir, f)); } catch(e) {}
                    });
                }
            }
        } catch (e) {
            console.error('[DATABASE] Error en backup pre-migración:', e);
        }
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

    // --- CASHUPS (ARQUEOS / CORTE Z) ---
    getCashups: (storeId) => getQuery(`SELECT * FROM cashups WHERE store_id = ? ORDER BY date DESC`, [storeId || '']),

    getCashupByDate: (storeId, date) => getQuery(`SELECT * FROM cashups WHERE store_id = ? AND date = ?`, [storeId || '', date]).then(r => r[0] || null),

    saveCashup: (storeId, cashup) => {
        const sid = storeId || '';
        return runQuery(
            `INSERT OR REPLACE INTO cashups (id, store_id, date, opening_usd, opening_ves, cash_usd, cash_ves, sales_usd, sales_ves, sales_pago_movil, sales_transfer, sales_card, sales_eur, expenses_total, transaction_count, counted_usd, counted_ves, diff_usd, diff_ves, cashier_name, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [cashup.id, sid, cashup.date, cashup.opening_usd || 0, cashup.opening_ves || 0, cashup.cash_usd || 0, cashup.cash_ves || 0, cashup.sales_usd || 0, cashup.sales_ves || 0, cashup.sales_pago_movil || 0, cashup.sales_transfer || 0, cashup.sales_card || 0, cashup.sales_eur || 0, cashup.expenses_total || 0, cashup.transaction_count || 0, cashup.counted_usd || 0, cashup.counted_ves || 0, cashup.diff_usd || 0, cashup.diff_ves || 0, cashup.cashier_name || '', cashup.status || 'closed', cashup.notes || '']
        );
    },

    getTodaySalesSummary: (storeId) => {
        const sid = storeId || '';
        const today = new Date().toISOString().split('T')[0];
        return getQuery(`
            SELECT
                COUNT(*) as transaction_count,
                COALESCE(SUM(CASE WHEN method = 'cash-usd' THEN totalUSD ELSE 0 END), 0) as sales_usd,
                COALESCE(SUM(CASE WHEN method = 'cash-ves' THEN totalVES ELSE 0 END), 0) as sales_ves,
                COALESCE(SUM(CASE WHEN method = 'pago-movil' THEN totalVES ELSE 0 END), 0) as sales_pago_movil,
                COALESCE(SUM(CASE WHEN method = 'transfer' THEN totalVES ELSE 0 END), 0) as sales_transfer,
                COALESCE(SUM(CASE WHEN method LIKE 'card%' THEN totalVES ELSE 0 END), 0) as sales_card,
                COALESCE(SUM(CASE WHEN method = 'cash-eur' OR method = 'eur' THEN totalEUR ELSE 0 END), 0) as sales_eur,
                COALESCE(SUM(totalUSD), 0) as total_usd,
                COALESCE(SUM(totalVES), 0) as total_ves
            FROM sales WHERE store_id = ? AND date LIKE ? AND (status IS NULL OR status != 'pending')
        `, [sid, today + '%']);
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
    getTransfers: (storeId, status) => {
        let sql = `SELECT * FROM stock_transfers WHERE (store_id = ? OR from_store = ? OR to_store = ?)`;
        let params = [storeId || '', storeId || '', storeId || ''];
        if (status && status !== 'all') { sql += ` AND status = ?`; params.push(status); }
        sql += ` ORDER BY timestamp DESC LIMIT 200`;
        return getQuery(sql, params);
    },

    saveTransfer: (storeId, transfer) => {
        const sid = storeId || '';
        return runQuery(
            `INSERT INTO stock_transfers (id, store_id, from_store, to_store, product_id, product_name, quantity, date, timestamp, status, cashier_name, notes, po_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [transfer.id, sid, transfer.from_store, transfer.to_store, transfer.product_id, transfer.product_name, transfer.quantity, transfer.date, transfer.timestamp, transfer.status || 'PENDING', transfer.cashier_name, transfer.notes || '', transfer.po_id || '']
        );
    },

    updateTransferStatus: (storeId, transferId, status) => runQuery(`UPDATE stock_transfers SET status = ? WHERE id = ? AND store_id = ?`, [status, transferId, storeId || '']),

    deleteTransfer: (storeId, transferId) => runQuery(`DELETE FROM stock_transfers WHERE id = ? AND store_id = ?`, [transferId, storeId || '']),

    // --- PURCHASE ORDERS ---
    getPurchaseOrders: (storeId, status) => {
        let sql = `SELECT * FROM purchase_orders WHERE (store_id = ? OR from_store = ? OR to_store = ?)`;
        let params = [storeId || '', storeId || '', storeId || ''];
        if (status && status !== 'all') { sql += ` AND status = ?`; params.push(status); }
        sql += ` ORDER BY timestamp DESC LIMIT 200`;
        return getQuery(sql, params);
    },

    savePurchaseOrder: async (storeId, po) => {
        const sid = storeId || '';
        await runQuery(
            `INSERT INTO purchase_orders (id, store_id, order_type, from_store, to_store, status, items, notes, total_cost, date, timestamp, created_by, approved_by, received_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [po.id, sid, po.order_type || 'purchase', po.from_store, po.to_store, po.status || 'PENDING', JSON.stringify(po.items || []), po.notes || '', po.total_cost || 0, po.date, po.timestamp, po.created_by || '', po.approved_by || '', po.received_date || '']
        );
        // Save individual items
        if (po.items && po.items.length) {
            for (const item of po.items) {
                const itemId = 'poi_' + Date.now() + '_' + Math.random().toString(36).substr(2,5);
                await runQuery(
                    `INSERT INTO po_items (id, store_id, po_id, product_id, product_name, quantity, received_qty, cost_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [itemId, sid, po.id, item.product_id, item.product_name, item.quantity || 0, item.received_qty || 0, item.cost_price || 0]
                );
            }
        }
        return po;
    },

    updatePOStatus: (storeId, poId, status) => runQuery(`UPDATE purchase_orders SET status = ? WHERE id = ? AND store_id = ?`, [status, poId, storeId || '']),

    receivePO: async (storeId, poId, items) => {
        const sid = storeId || '';
        await runQuery(`UPDATE purchase_orders SET status = 'RECEIVED', received_date = ? WHERE id = ? AND store_id = ?`, [new Date().toISOString(), poId, sid]);
        for (const item of items) {
            await runQuery(`UPDATE po_items SET received_qty = ? WHERE po_id = ? AND product_id = ?`, [item.received_qty, poId, item.product_id]);
            // Update product stock
            const product = (await getQuery(`SELECT * FROM products WHERE id = ? AND store_id = ?`, [item.product_id, sid]))[0];
            if (product) {
                await runQuery(`UPDATE products SET stock = stock + ? WHERE id = ? AND store_id = ?`, [item.received_qty, item.product_id, sid]);
            }
        }
    },

    deletePO: (storeId, poId) => {
        const sid = storeId || '';
        return Promise.all([
            runQuery(`DELETE FROM purchase_orders WHERE id = ? AND store_id = ?`, [poId, sid]),
            runQuery(`DELETE FROM po_items WHERE po_id = ? AND store_id = ?`, [poId, sid])
        ]);
    },

    // --- LOYALTY POINTS ---
    getLoyaltyPoints: (storeId) => getQuery(`SELECT lp.*, cl.name as client_name, cl.document as client_document FROM loyalty_points lp LEFT JOIN clients cl ON lp.client_id = cl.id AND lp.store_id = cl.store_id WHERE lp.store_id = ? ORDER BY lp.points DESC`, [storeId || '']),

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
    getInvoices: (storeId) => getQuery(`SELECT i.*, s.total, s.date as sale_date, cl.name as client_name FROM invoices i LEFT JOIN sales s ON i.sale_id = s.id AND i.store_id = s.store_id LEFT JOIN clients cl ON s.client_id = cl.id AND s.store_id = cl.store_id WHERE i.store_id = ? ORDER BY i.sent_date DESC`, [storeId || '']),

    saveInvoice: (storeId, invoice) => {
        const sid = storeId || '';
        return runQuery(
            `INSERT INTO invoices (id, store_id, sale_id, client_email, sent_date, status, pdf_data) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [invoice.id, sid, invoice.sale_id, invoice.client_email, invoice.sent_date, invoice.status || 'SENT', invoice.pdf_data || '']
        );
    },
};

// ==========================================
// MIGRACIÓN: Asignar store_id a datos huérfanos
// Productos, clientes, ventas sin store_id se asignan
// al storeId proporcionado para evitar que aparezcan
// en todos los stores (cruce de inventario).
// ==========================================
async function migrateOrphanData(storeId) {
    if (!storeId) return;
    const sid = String(storeId).trim();
    if (!sid) return;

    const tables = [
        { name: 'products', idCol: 'id' },
        { name: 'clients', idCol: 'id' },
        { name: 'sales', idCol: 'id' },
        { name: 'credits', idCol: 'id' },
        { name: 'credit_payments', idCol: 'id' },
        { name: 'ingredients', idCol: 'id' },
        { name: 'recipes', idCol: 'id' },
        { name: 'settings', idCol: 'key' },
        { name: 'cashups', idCol: 'id' },
        { name: 'movements', idCol: 'id' },
        { name: 'stock_transfers', idCol: 'id' },
        { name: 'purchase_orders', idCol: 'id' },
        { name: 'po_items', idCol: 'id' },
        { name: 'loyalty_points', idCol: 'client_id' },
        { name: 'invoices', idCol: 'id' }
    ];

    let totalMigrated = 0;
    for (const table of tables) {
        try {
            const orphans = await getQuery(
                `SELECT ${table.idCol} FROM ${table.name} WHERE store_id IS NULL OR store_id = ''`
            );
            if (orphans && orphans.length > 0) {
                await runQuery(
                    `UPDATE ${table.name} SET store_id = ? WHERE store_id IS NULL OR store_id = ''`,
                    [sid]
                );
                totalMigrated += orphans.length;
            }
        } catch(e) { /* tabla no existe aún */ }
    }
    if (totalMigrated > 0) {
        console.log(`[DATABASE] Migración: ${totalMigrated} registros huérfanos asignados al store ${sid}`);
    }
    return totalMigrated;
}

module.exports = { initDatabase, api, migrateOrphanData };
