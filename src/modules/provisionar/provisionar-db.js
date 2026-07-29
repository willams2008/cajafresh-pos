/**
 * provisionar-db.js - Persistencia con Dexie.js
 * Capa de datos para el modulo Provisionar (Caja Fresh POS)
 * Reemplaza localStorage con IndexedDB via Dexie.js
 */
(function() {
    var db = new Dexie('CajaFresh_ProvisionarDB');

    db.version(1).stores({
        materiales: '++id, nombre, tipo, espesor, fechaCreacion',
        cotizaciones: '++id, cliente, fecha, total'
    });

    window.ProvisionarDB = {
        async init() {
            try {
                await db.open();
                console.log('[ProvisionarDB] Base de datos lista.');
                await this.migrarDesdeLocalStorage();
            } catch (err) {
                console.error('[ProvisionarDB] Error al abrir DB:', err);
            }
        },

        async obtenerMateriales() {
            return await db.materiales.toArray();
        },

        async obtenerMaterialPorId(id) {
            return await db.materiales.get(Number(id));
        },

        async guardarMaterial(material) {
            material.actualizadoEn = new Date().toISOString();
            if (material.id) {
                material.id = Number(material.id);
                await db.materiales.put(material);
                return material.id;
            } else {
                material.fechaCreacion = new Date().toISOString();
                return await db.materiales.add(material);
            }
        },

        async eliminarMaterial(id) {
            await db.materiales.delete(Number(id));
        },

        async migrarDesdeLocalStorage() {
            var claveMigracion = 'provisionar_migrado_v1';
            if (localStorage.getItem(claveMigracion)) return;

            var viejosMateriales = localStorage.getItem('provisionar_materiales');
            if (viejosMateriales) {
                try {
                    var items = JSON.parse(viejosMateriales);
                    if (Array.isArray(items) && items.length > 0) {
                        for (var i = 0; i < items.length; i++) {
                            delete items[i].id;
                            await db.materiales.add(items[i]);
                        }
                        console.log('[ProvisionarDB] Migrados ' + items.length + ' materiales desde localStorage.');
                    }
                } catch (e) {
                    console.error('[ProvisionarDB] Error durante la migracion:', e);
                }
            }
            localStorage.setItem(claveMigracion, 'true');
        }
    };
})();
