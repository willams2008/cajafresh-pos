const sqlite3 = require('sqlite3');
const path = require('path');
const dbPath = path.join(process.env.APPDATA, 'puntopila-pos', 'database', 'freshpos.sqlite');
const db = new sqlite3.Database(dbPath);

const storeId = '';

const testProducts = [
  { id: 'prod_001', name: 'Empanada de Carne', category: 'Comida', priceUSD: 2.5, stock: 50, minStock: 10 },
  { id: 'prod_002', name: 'Empanada de Queso', category: 'Comida', priceUSD: 2.0, stock: 50, minStock: 10 },
  { id: 'prod_003', name: 'Pastelito de Pollo', category: 'Comida', priceUSD: 2.5, stock: 40, minStock: 10 },
  { id: 'prod_004', name: 'Cachapa de Queso', category: 'Comida', priceUSD: 4.0, stock: 30, minStock: 5 },
  { id: 'prod_005', name: 'Tequeño (unidad)', category: 'Comida', priceUSD: 1.5, stock: 100, minStock: 20 },
  { id: 'prod_006', name: 'Hamburguesa Clásica', category: 'Comida', priceUSD: 5.0, stock: 20, minStock: 5 },
  { id: 'prod_007', name: 'Perro Caliente', category: 'Comida', priceUSD: 3.5, stock: 25, minStock: 5 },
  { id: 'prod_008', name: 'Pepsi 355ml', category: 'Bebidas', priceUSD: 1.0, stock: 100, minStock: 20 },
  { id: 'prod_009', name: 'Coca Cola 355ml', category: 'Bebidas', priceUSD: 1.0, stock: 100, minStock: 20 },
  { id: 'prod_010', name: 'Agua Mineral 500ml', category: 'Bebidas', priceUSD: 0.75, stock: 80, minStock: 15 },
  { id: 'prod_011', name: 'Jugo Natural de Naranja', category: 'Bebidas', priceUSD: 2.0, stock: 30, minStock: 5 },
  { id: 'prod_012', name: 'Papas Fritas (porción)', category: 'Comida', priceUSD: 2.0, stock: 60, minStock: 10 },
];

db.serialize(() => {
  db.run(`DELETE FROM products WHERE store_id = ?`, storeId, (err) => {
    if (err) return console.error('Error deleting:', err);
    console.log('✅ Productos actuales eliminados.');

    const stmt = db.prepare(`INSERT OR REPLACE INTO products (id, store_id, name, category, priceUSD, priceVES, priceEUR, costPrice, stock, minStock, featured, flavors, expiryDate, description, img, barcode, flavorBarcodes, presentations, composite, variants, points) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

    let count = 0;
    for (const p of testProducts) {
      stmt.run(p.id, storeId, p.name, p.category, p.priceUSD, 0, 0, 0, p.stock, p.minStock, 0, '[]', '', '', '', '', '{}', '[]', '{}', '[]', 0);
      count++;
    }
    stmt.finalize();
    console.log(`✅ ${count} productos de prueba insertados.`);
  });
});

db.close();
