/**
 * Tests unitarios para cloud-sync.js
 */

const path = require('path');
const os = require('os');
const fs = require('fs');

const CloudSync = require('../cloud-sync');

describe('CloudSync Module', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-sync-test-'));
    });

    afterEach(() => {
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch (e) {
            // ignore
        }
    });

    test('inicializa con valores por defecto', () => {
        const sync = new CloudSync();
        expect(sync.enabled).toBe(false);
        expect(sync.storeType).toBe('kiosko');
        expect(sync.tenantId).toBe('tenant_default');
        expect(sync.brandName).toBe('Caja Fresh');
        expect(sync.lastStatus.synced).toBe(false);
        sync.destroy();
    });

    test('configura opciones personalizadas correctamente', () => {
        const sync = new CloudSync({
            supabaseUrl: 'https://xyzcompany.supabase.co',
            supabaseKey: 'test-api-key',
            storeId: 'store_001',
            tenantId: 'tenant_acme',
            storeType: 'warehouse',
            brandName: 'Punto Pila',
            queuePath: tmpDir,
        });

        expect(sync.enabled).toBe(true);
        expect(sync.supabaseUrl).toBe('https://xyzcompany.supabase.co');
        expect(sync.storeId).toBe('store_001');
        expect(sync.tenantId).toBe('tenant_acme');
        expect(sync.storeType).toBe('warehouse');
        expect(sync.brandName).toBe('Punto Pila');
        sync.destroy();
    });

    test('configure() actualiza parámetros dinámicamente', () => {
        const sync = new CloudSync();
        expect(sync.enabled).toBe(false);

        sync.configure({
            supabaseUrl: 'https://test.supabase.co/',
            supabaseKey: 'key_123',
            storeId: 'sucursal_norte',
            storeType: 'kiosko',
            queuePath: tmpDir,
        });

        expect(sync.enabled).toBe(true);
        expect(sync.supabaseUrl).toBe('https://test.supabase.co'); // sin trailing slash
        expect(sync.storeId).toBe('sucursal_norte');
        expect(sync.storeType).toBe('kiosko');
        sync.destroy();
    });

    test('gestiona cola de pendientes y persistencia en disco', () => {
        const sync = new CloudSync({
            queuePath: tmpDir,
        });

        sync.pendingQueue.push({ action: 'sale', id: 's1', amount: 15.5 });
        sync.pendingQueue.push({ action: 'product', id: 'p1', name: 'Refresco' });
        sync._savePendingQueue();

        const queueFile = path.join(tmpDir, 'cloud_sync_queue.json');
        expect(fs.existsSync(queueFile)).toBe(true);

        const loaded = JSON.parse(fs.readFileSync(queueFile, 'utf8'));
        expect(loaded).toHaveLength(2);
        expect(loaded[0].id).toBe('s1');
        expect(loaded[1].name).toBe('Refresco');

        // Nuevo sync leyendo el directorio persistido
        const sync2 = new CloudSync({ queuePath: tmpDir });
        sync2._loadPendingQueue();
        expect(sync2.pendingQueue).toHaveLength(2);

        sync.destroy();
        sync2.destroy();
    });

    test('registra productos eliminados para sincronización', () => {
        const sync = new CloudSync({
            queuePath: tmpDir,
        });

        sync.addDeletedProductId('prod_del_99');
        expect(sync.deletedProductIds.has('prod_del_99')).toBe(true);

        const deletedFile = path.join(tmpDir, 'deleted_product_ids.json');
        expect(fs.existsSync(deletedFile)).toBe(true);

        sync.removeDeletedProductId('prod_del_99');
        expect(sync.deletedProductIds.has('prod_del_99')).toBe(false);

        sync.destroy();
    });
});
