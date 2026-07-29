# INSTRUCCIONES PARA ANTIGRAVITY — Integración de Módulos

## Archivos entregados

### `src/features/` — Funciones completas y autónomas
| Archivo | Namespace | Dependencias |
|---------|-----------|-------------|
| `multi-orden.js` | `window.MultiOrder` | Ninguna (usa `cart[]`, `sales[]`, `products[]` globales) |
| `calculadora.js` | `window.POSCalculator` | Ninguna (usa `settings.exchangeRate` opcional) |

### `src/modules/` — Módulos base del sistema (strangler pattern)
| Archivo | Namespace | Dependencias |
|---------|-----------|-------------|
| `pos.js` | `window.POS` | app.js (wraps `addToCart`, `updateCartUI`, etc.) |
| `reports.js` | `window.Reports` | app.js (wraps `renderReports`), `window.sales` |
| `dashboard.js` | `window.Dashboard` | app.js globals (`sales`, `products`, `expenses`, `settings`) |
| `notifications.js` | `window.Notifications` | app.js globals, `Swal.fire()` |
| `master-styles.js` | Inyecta CSS automático | Ninguna |
| `auto-update.js` | `window.UpdateManager` | app.js, preload.js, main.js, electron-updater |

### `src/renderer/` — Entregados previamente
| Archivo | Namespace | Qué contiene |
|---------|-----------|-------------|
| `analytics-financiero.js` | `window.FinancialAnalytics` | ABC, BCG, GMROI, COGS, márgenes, mermas, JSON export |
| `funciones-pendientes.js` | `window.POSExtensions` | Anular venta, ajuste stock, proveedores CRUD, respaldo, etc. |

---

## Orden de integración sugerido

### Fase 1 — Cargar los scripts (sin activar nada)
Agregar en `index.html` ANTES de `</body>`:

```html
<!-- Core Modules -->
<script src="src/modules/master-styles.js"></script>
<script src="src/modules/notifications.js"></script>
<script src="src/modules/dashboard.js"></script>
<script src="src/modules/reports.js"></script>
<script src="src/modules/pos.js"></script>

<!-- Features -->
<script src="src/features/multi-orden.js"></script>
<script src="src/features/calculadora.js"></script>

<!-- Auto-Update -->
<script src="src/modules/auto-update.js"></script>
```

### Auto-Update (requiere integrar en Electron)
`auto-update.js` solo es el frontend. Para que funcione necesita cambios en 3 archivos de Electron:

**`main.js`** — Agregar al inicio:
```js
const { autoUpdater } = require('electron-updater');
```
Agregar después de los IPC handlers existentes:
```js
// ===== AUTO-UPDATER =====
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

function setupAutoUpdater() {
    autoUpdater.on('checking-for-update', () => {
        if (mainWindow && !mainWindow.isDestroyed())
            mainWindow.webContents.send('update-status', { status: 'checking' });
    });
    autoUpdater.on('update-available', (info) => {
        if (mainWindow && !mainWindow.isDestroyed())
            mainWindow.webContents.send('update-status', { status: 'available', info });
    });
    autoUpdater.on('update-not-available', (info) => {
        if (mainWindow && !mainWindow.isDestroyed())
            mainWindow.webContents.send('update-status', { status: 'not-available', info });
    });
    autoUpdater.on('download-progress', (progress) => {
        if (mainWindow && !mainWindow.isDestroyed())
            mainWindow.webContents.send('update-status', { status: 'downloading', progress });
    });
    autoUpdater.on('update-downloaded', (info) => {
        if (mainWindow && !mainWindow.isDestroyed())
            mainWindow.webContents.send('update-status', { status: 'downloaded', info });
    });
    autoUpdater.on('error', (err) => {
        if (mainWindow && !mainWindow.isDestroyed())
            mainWindow.webContents.send('update-status', { status: 'error', error: err.message });
    });
}

ipcMain.handle('check-for-updates', async () => {
    try { autoUpdater.autoDownload = false; await autoUpdater.checkForUpdates(); return { success: true }; }
    catch (err) { return { success: false, error: err.message }; }
});
ipcMain.handle('download-update', async () => {
    try { autoUpdater.autoDownload = true; autoUpdater.downloadUpdate(); return { success: true }; }
    catch (err) { return { success: false, error: err.message }; }
});
ipcMain.handle('install-update', () => {
    setImmediate(() => autoUpdater.quitAndInstall());
    return { success: true };
});
// Auto-check a los 30s y cada 4h
setTimeout(() => { if (mainWindow && !mainWindow.isDestroyed()) autoUpdater.checkForUpdates().catch(() => {}); }, 30000);
setInterval(() => { autoUpdater.checkForUpdates().catch(() => {}); }, 4 * 60 * 60 * 1000);
```
Llamar `setupAutoUpdater();` al final de `createWindow()`.

**`preload.js`** — Agregar en `electronAPI`:
```js
onUpdateStatus: (callback) => ipcRenderer.on('update-status', (event, data) => callback(data)),
checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
downloadUpdate: () => ipcRenderer.invoke('download-update'),
installUpdate: () => ipcRenderer.invoke('install-update'),
```

**`package.json`** — Cambiar `"target": "dir"` a `"target": ["nsis"]` y agregar:
```json
"nsis": {
    "oneClick": false,
    "allowToChangeInstallationDirectory": true,
    "deleteAppDataOnUninstall": false
},
"publish": [
    {
        "provider": "generic",
        "url": "https://cajafresh.emprende.ve/updates",
        "channel": "latest"
    }
]
```
Instalar: `npm install electron-updater`

Luego cada vez que subas un nuevo `.exe` + `latest.yml` a `https://cajafresh.emprende.ve/updates/`, los clientes recibirán la notificación de actualización automáticamente.

### Fase 2 — Activar módulos (en el DOMContentLoaded o después de app.js)

```js
// POS — cart persistente, atajos, hint bar
if (typeof POS !== 'undefined') POS.init();

// Notificaciones — badge flotante + panel
if (typeof Notifications !== 'undefined') Notifications.init();

// Filtro de fecha en reportes
if (typeof Reports !== 'undefined') Reports.initDateFilter();

// Auto-Update — notificación flotante (solo si ya integraste los cambios en Electron)
if (typeof UpdateManager !== 'undefined') UpdateManager.init();

// Multi-orden — barra de órdenes en POS
if (typeof MultiOrder !== 'undefined') {
    MultiOrder.init({
        onSwitch: function(items) {
            console.log('[MultiOrder] Orden activa cambiada,', items.length, 'items');
        }
    });
}
```

### Fase 3 — Conectar funciones a la UI existente

#### 3a. Dashboard (vista de inicio)
- Crear en `index.html`:
```html
<section id="view-dashboard" class="...view-section... hidden">
    <header>...</header>
    <div id="view-dashboard-content"></div>
</section>
```
- Agregar nav link `<a id="nav-dashboard">` en el menú lateral
- En `app.js` `initNavigation()`, agregar:
  - `'nav-dashboard': 'view-dashboard'` en `navItems`
  - `if (viewId === 'view-dashboard' && typeof Dashboard !== 'undefined') Dashboard.render();`
- La calculadora se auto-inyecta si existe `<div id="calculadora-container">` dentro del dashboard

#### 3b. Anular venta desde tabla de reportes
En `app.js` función `renderReports()`, dentro del `tr.innerHTML`, agregar después del botón de imprimir:
```html
<button onclick="POSExtensions.voidSale('${displayTicket}', 'Anulación manual')" 
    class="text-red-500 hover:bg-red-50 p-2 rounded-lg" title="Anular Venta">
    <i class="fas fa-ban"></i>
</button>
```

#### 3c. Cuadre de caja
Agregar botón en el header de `view-reports`:
```html
<button onclick="Reports.openCashReconciliation()"
    class="text-amber-600 bg-amber-50 hover:bg-amber-100 font-bold px-4 py-2 rounded-xl">
    <i class="fas fa-calculator"></i> Cuadre de Caja
</button>
```

#### 3d. Calculadora en dashboard
Se inicializa automáticamente si el contenedor existe (`#calculadora-container` dentro de `#view-dashboard-content`).

#### 3e. Gastos con categoría y edición
Reemplazar la función `openExpenseModal()` actual por:
```js
// En lugar de openExpenseModal(), usar:
POSExtensions.openExpenseModalAdvanced(null);
```
Y reemplazar `renderExpenses()` por:
```js
POSExtensions.renderExpensesAdvanced(expenses, 'expenses-table-body');
```

---

## Resumen de lo que cada módulo hace (para decisión)

### Si solo quieres 3 cosas con más impacto:
1. **`Reports.initDateFilter()`** — Selector de fecha en reportes (5 líneas, valor inmediato)
2. **`POS.init()`** — Cart persistente + atajos (Ctrl+F, F12) — evita pérdida de carrito
3. **`POSExtensions.voidSale()`** — Botón anular venta — necesario para corregir errores

### Si quieres el dashboard completo:
4. **`Dashboard.render()`** + view-dashboard en HTML + nav link

### Si quieres el sistema multi-orden:
5. **`MultiOrder.init()`** — Requiere probar con cajeros reales, puede cambiar el flujo de trabajo

### Para reportes financieros reales:
6. **`FinancialAnalytics`** — ABC, BCG, GMROI — Ver `analytics-financiero.js`

---

## Notas técnicas

- Todos los módulos usan `window.Namespace = (function(){ ... return API; })();` — zero risk de colisión
- El CSS se inyecta vía JS con `document.head.appendChild()` — no toca `style.css`
- `POS.saveCart()` se llama automáticamente hookeando `updateCartUI` original
- `Notifications.refresh()` corre cada 30s — escanea stock bajo, créditos, márgenes
- `Reports.openCashReconciliation()` usa `Swal.fire()` con inputs en vivo — calcular diferencias on-the-fly
- `FinancialAnalytics.saveCostSnapshot()` debe llamarse después de cada compra para que funcione el análisis de tendencia de costos
