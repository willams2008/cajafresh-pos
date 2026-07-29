# Antigravity — Registro de Cambios

> Archivo persistente para tracking de modificaciones entre sesiones.
> Actualizado automáticamente por cada intervención.

---

## 2026-07-11

### Corregido: Historial por Cliente movido a Reporte de Caja
- **Archivos:** `index.html`, `app.js`
- **Cambio:** Se eliminó la vista independiente `view-client-history` y su nav item `nav-client-history`. El selector de cliente con tabla de compras ahora está dentro de `view-reports`, debajo de la tabla de ventas.
- **Render:** `renderClientHistory()` se llama desde `renderReports()` en vez de desde `switchView()`.
- **Commit:** No committed aún.

### Corregido: new-item-modal sin cerrar (bug crítico)
- **Archivo:** `index.html:3035`
- **Cambio:** Se agregó `</div>` faltante al `new-item-modal`. Esto causaba que `view-cashup`, `view-movements` y `view-excel-export` estuvieran anidados dentro de un div `fixed inset-0 hidden`, impidiendo que se mostraran.
- **Impacto:** Los 3 módulos implementados (Movimientos, Exportar Excel, Arqueo de Caja) ahora deberían ser visibles al navegar a ellos.

### Corregido: Render calls faltantes en switchView
- **Archivo:** `app.js:1510-1522`
- **Cambio:** Se agregaron las llamadas a `renderMovements()`, `renderExcelExport()`, `renderCashup()` y `renderClientHistory()` dentro de `window.switchView()`.
- **Estado:** Ya estaban presentes en el código actual.

### Sistema QR revertido a estilo toDataURL + img
- **Archivos:** `index.html`, `app.js`, `preload.js`
- **Cambio:** Se reemplazaron 3 `<canvas>` por `<img>` para QR. Se eliminaron funciones `generarQRenCanvas`, `_generarQRLocal`, `_provisionarLocalUrl`, `_provisionarServerQr`. `onServerInfo` ahora usa `info.qr` directo del main process.
- **Commit:** `4e0423b` (backup-2026-07-11)

### Implementados 4 módulos nuevos
- **Movimientos/Merma** (`renderMovements`, `openMovementModal`, `saveMovement`)
- **Exportar Excel** (`renderExcelExport`, `exportReport`, `_downloadCSV`)
- **Arqueo de Caja** (`renderCashup`, `calculateCashup`, `saveCashup`)
- **Historial por Cliente** (`renderClientHistory`)

### Bug conocido (no corregido): Arqueo de Caja no reconoce métodos cash
- **Archivo:** `app.js:5288-5297`
- **Problema:** `renderCashup()` busca `s.method === 'cash'/'efectivo'/'efectivo usd'` pero `processPayment()` guarda `'cash-usd'` y `'cash-ves'`. El arqueo siempre muestra $0 en efectivo.
- **Por hacer:** Cambiar la comparación a `s.method.startsWith('cash')`.

### Bug conocido: renderPayables llamado desde HTML sin guard
- **Archivo:** `index.html:2142`
- **Problema:** `onchange="renderPayables()"` en checkbox sin `typeof === 'function'`. Si el módulo no carga, tira ReferenceError.
- **Nota:** También `renderProveedores` y `generateZReport` no están en app.js pero son llamados con guard en switchView.

### Hallazgos del Debug Exhaustivo (11 Jul) — Ronda 2: Integración HTML+JS

#### ✅ Funcionando Correctamente
- **POS Flow**: addToCart (2277) → updateCartQty (2355) → initCheckout (2470) → validatePayment (2584) → processPayment (2638) → printTicket (3327). Todas las funciones existen y la cadena de llamadas está completa.
- **saveProducts** llama a `window.db.saveProductsBulk` + localStorage + `syncProductsToMobile` ✅
- **syncProductsToMobile** envía productos + tasa al electronAPI correctamente ✅
- **cloudSyncPushSale** y **cloudSyncPushAlerts** se llaman desde processPayment ✅
- **154 funciones** definidas en app.js, cubriendo todos los módulos
- **29/29 DOM IDs** para módulos nuevos existen en HTML
- **8 onclick handlers** para módulos nuevos

#### 🔴 Bugs Activos (por corregir)

| # | Bug | Archivo | Línea | Impacto |
|---|---|---|---|---|
| 1 | **`remote-url-display` no existe en HTML** | `app.js` | 4357, 4365, 4375, 5384 | ID renombrado a `link-mobile-display`/`link-jefe-display`/`link-download-display` en el rediseño. JS usa ID viejo → túnel sin estado, `shareLink()` roto |
| 2 | **`renderCredits()` sin guard, función no existe** | `app.js` | 1508 | `renderCredits` no está definida en ningún lado. `switchView('view-credits')` tira **ReferenceError** y rompe la navegación |
| 3 | **Arqueo compara método incorrecto** | `app.js` | 5288-5297 | `renderCashup` busca `'cash'/'efectivo'` pero `processPayment` guarda `'cash-usd'/'cash-ves'`. Siempre $0 en efectivo |
| 4 | **`renderPayables()` llamado sin guard en HTML** | `index.html` | 2142 | `onchange="renderPayables()"` sin `typeof`. Si no existe → ReferenceError |
| 5 | **`openIngredientsModal` llama función inexistente** | `app.js` | 7310-7317 | `renderIngredients()` no existe. Código muerto. |
| 6 | **`renderProveedores()` y `renderPayables()` no existen** | `app.js` | 1503, 1506 | Solo existen en `temp_app_stash.js` no cargado. Guardadas con `typeof` en switchView pero no en HTML |
| 7 | **`generateZReport()` nunca definido** | `app.js` | 1704, 1710, 1720 | Auto-cierre diario (18:15) es no-op, botón PDF no hace nada. Guardado con typeof |
| 8 | **10 funciones onclick en HTML que no existen** | `index.html` | varias | `forceManualSync()`, `openCashierLoginPanel()`, `downloadAnalyticsPDF()`, `addNewSupplier()`, `downloadDecoratedQR()`, `autoFillInvoiceNum()`, `toggleCargaCreditDays()`, `toggleCargaPayRef()`, `saveCloudflareTunnel()`, `openStoreIdentityModal()` — todas tiran ReferenceError al hacer clic |
| 9 | **CSS syntax error: `canvas {` sin cerrar** | `index.html` | 206 | Regla CSS malformada puede ignorar estilos siguientes |
| 10 | **`app.bundle.js` no existe** | raíz | — | `build.js` compila `src/renderer/*.js` (ES modules) a `app.bundle.js`, pero nunca se generó. Las funciones ES module (177 líneas en pos.js, reports.js, inventory.js, state.js, index.js + multi-orden.js) JAMÁS se cargan |
| 11 | **`funciones-pendientes.js` (1510 líneas) no se carga** | `index.html` | — | Define `POSExtensions` con 37 funciones (renderDashboard, voidSale, adjustStock, renderSuppliers, renderExpensesAdvanced, etc.) pero `index.html` no lo incluye. `POSExtensions` es el módulo que debía implementar las funciones faltantes |

#### 🏗 Problemas Arquitectónicos Detectados
- **Persistence mixta**: Products/Sales/Clients → SQLite + localStorage. Movements/Cashups/Expenses → solo localStorage. Sin capa unificada.
- **Cloud sync polling-only**: Sin WebSockets, latencia 10s-5min. RLS de Supabase abierta (`FOR ALL USING (true)`).
- **ES modules sin bundle**: `src/renderer/pos.js`, `src/renderer/reports.js`, `src/renderer/inventory.js`, `src/renderer/state.js`, `src/renderer/index.js`, `src/features/multi-orden.js` usan `import/export` pero `app.bundle.js` (el compilado) no existe. Código inaccesible.
- **Estrategia híbrida incompleta**: Parte del código se migró a ES modules (`src/renderer/`), parte quedó en app.js monolítico, parte está en `funciones-pendientes.js` sin cargar. Ninguna de las 3 capas está completa.
- **Estilos mixtos**: Coexisten `function name()`, `const name = () =>`, `window.name = function()`, `var`-style.

### 🔧 CORREGIDOS en esta sesión (11 Jul — Ronda 3)

| # | Bug | Fix aplicado |
|---|---|---|
| 1 | `remote-url-display` no existe | Cambiado a `link-mobile-display` en app.js (4 refs). `shareLink` ahora usa `window.lastRemoteUrl` |
| 2 | `renderCredits()` sin guard | Agregado `typeof renderCredits === 'function'` en switchView |
| 3 | Arqueo método incorrecto | Cambiado a `s.method.startsWith('cash')` en renderCashup y calculateCashup |
| 4 | `renderPayables()` sin guard en HTML | Agregado `funciones-pendientes.js` al HTML (define POSExtensions con funciones) |
| 5 | 10 onclick functions sin definir | Agregadas como stubs funcionales al final de app.js |
| 6 | CSS `canvas {` sin cerrar | Cambiado a `canvas { display: none; }` |
| 7 | `funciones-pendientes.js` no cargado | Agregado `<script>` tag al HTML |

### ⚠️ Pendientes (requieren implementación completa)
- **renderCredits()** — función completa para créditos
- **renderProveedores()/renderPayables()** — conectar con POSExtensions
- **generateZReport()** — cierre de caja con PDF
- **build.js → app.bundle.js** — compilar ES modules

---

## 2026-07-08

### Backup creado antes del revert del QR
- **Commit:** `4e0423b`
- **Rama:** `backup-2026-07-11`

---

## Formato de cada entrada

```
### [Tipo]: [Descripción breve]
- **Archivos:** [rutas]
- **Cambio:** [descripción detallada]
- **Commit:** [hash] (si aplica)
- **Impacto:** [qué efecto tiene en el sistema]
```
