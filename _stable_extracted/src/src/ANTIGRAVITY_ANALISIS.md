# REPORTE DE ANÁLISIS TÉCNICO — Caja Fresh POS

## 1. BUGS CORREGIDOS

### 1.1 `generateZReport is not defined` → CRÍTICO
**Archivo:** `app.js` — líneas 1658, 1664, 1674
**Síntoma:** El `setInterval` de auto-cierre (18:15) llama `generateZReport(true)` pero la función **no existe en ningún archivo del proyecto**. Esto lanza un `ReferenceError` que (por el error handler global forzado a capturar todo) causa un reload de página.
**Fix aplicado:** Las 3 llamadas ahora están envueltas en `typeof generateZReport === 'function'`.

### 1.2 Validación de stock con `undefined`
**Archivo:** `app.js` — líneas 2235 y 2291
**Síntoma:** `product.stock <= 0` y `cart.qty >= product.stock` fallan silenciosamente si `product.stock` es `undefined` (dato corrupto de localStorage). En `undefined <= 0` da `false`, permitiendo vender sin stock.
**Fix aplicado:** Cambiado a `(product.stock || 0)` en ambas líneas.

---

## 2. VULNERABILIDADES / RIESGOS

### 2.1 API Key de Gemini expuesta en frontend
**Archivo:** `app.js:3647-3650`
```js
const apiKey = localStorage.getItem('gemini_api_key');
```
**Riesgo:** Bajo para POS local, pero cualquier extensión del navegador podría leerla. No hay backend que opaque la key.

### 2.2 CallMeBot API key en URL
**Archivo:** `app.js:6684`
```js
fetch(`https://api.callmebot.com/whatsapp.php?phone=${bossPhone}&text=${urlMsg}&apikey=${apiKey}`)
```
**Riesgo:** La key viaja en la URL (logs del servidor, referrer). Aceptable para uso local.

### 2.3 No hay autenticación de usuarios
**Riesgo:** Cualquiera con acceso físico a la PC puede cerrar caja, borrar productos, modificar precios. El PIN de admin (`32447974`) está hardcodeado en `app.js:5477`.

---

## 3. DEUDA TÉCNICA

### 3.1 Archivo monolítico
- **app.js:** 6914 líneas, ~200KB
- **Problema:** Una sola función `renderAnalytics()` hace ~286 líneas mezclando cálculos, manipulación DOM, lógica de negocio y actualización de UI.
- **Solución parcial:** Los módulos en `src/modules/` (pos.js, reports.js, dashboard.js, notifications.js) establecen el namespace pattern. Los módulos en `src/features/` (multi-orden.js, calculadora.js) y `src/renderer/` (analytics-financiero.js, funciones-pendientes.js) contienen funciones nuevas sin tocar app.js.

### 3.2 Sin tests automatizados
- **Problema:** Cero tests unitarios o de integración. `tests/database.test.js` existe pero solo prueba SQLite, no las funciones de negocio.
- **Riesgo:** Cada cambio en app.js es a ciegas.

### 3.3 Variables globales sin control
- **Problema:** `sales`, `products`, `cart`, `expenses`, `dailyHistory` son mutables desde cualquier función. No hay encapsulamiento.
- **Riesgo:** Una función puede modificar `sales` sin que otra se entere.

### 3.4 Código duplicado y stubs
- `src/renderer/reports.js` — existe pero `renderReports()` real está en app.js. El archivo tiene stubs.
- `src/renderer/inventory.js` — igual, `renderInventory()` real está en app.js.
- `_features_backup/` — contiene devoluciones, historial de precios, etc. que nunca se integraron.

---

## 4. OBSERVACIONES DE ARQUITECTURA

### 4.1 El sistema no es multi-sucursal real
`syncDashboardData()` (app.js:825) envía datos a la app del jefe vía Electron, pero no hay un backend centralizado. Cada POS es isla. `cloud-sync.js` conecta a Supabase pero es unidireccional (push).

### 4.2 IVA desactivado globalmente
`const TAX_RATE = 0;` (app.js:629) — el sistema fue diseñado con IVA pero se desactivó. `generateLibroIVA()` usa 16% fijo, asumiendo que todas las ventas pagan IVA.

### 4.3 El costo de producto no tiene trazabilidad
- `costPrice` se sobrescribe en cada compra (app.js:3584).
- No hay `costHistory[]`, no hay `unitCostAtSale` congelado en cada venta.
- La "Ganancia Real" en reportes usa una heurística: si costos > 95% de ventas, asume 30% de margen (app.js:2748-2751). Esto oculta datos corruptos en vez de señalarlos.

### 4.4 No hay cuadre de caja real
El cierre actual solo muestra totales. No hay verificación de "lo esperado vs lo físico" por método de pago. El módulo `Reports.openCashReconciliation()` en `src/modules/reports.js` implementa esto pero está pendiente de integrar.

---

## 5. NUEVOS MÓDULOS ENTREGADOS (pendientes de integrar)

### `src/modules/` — Core
| Módulo | Namespace | Estado |
|--------|-----------|--------|
| pos.js | `window.POS` | **Sin integrar** — cart persistente, atajos (Ctrl+F, F12), hint bar |
| reports.js | `window.Reports` | **Sin integrar** — filtro fecha reportes, cuadre de caja, desglose pago |
| dashboard.js | `window.Dashboard` | **Sin integrar** — vista inicio con KPIs y alertas |
| notifications.js | `window.Notifications` | **Sin integrar** — badge + panel notificaciones en vivo |
| master-styles.js | CSS automático | **Sin integrar** — estilos de todos los módulos anteriores |

### `src/features/` — Features
| Módulo | Namespace | Estado |
|--------|-----------|--------|
| multi-orden.js | `window.MultiOrder` | **Sin integrar** — órdenes múltiples estilo Papas |
| calculadora.js | `window.POSCalculator` | **Sin integrar** — widget calculadora |

### `src/renderer/` — Anteriores
| Módulo | Namespace | Estado |
|--------|-----------|--------|
| analytics-financiero.js | `window.FinancialAnalytics` | **Sin integrar** — ABC, BCG, GMROI, COGS, márgenes, mermas, JSON export |
| funciones-pendientes.js | `window.POSExtensions` | **Sin integrar** — anular venta, ajuste stock, proveedores CRUD, respaldo, gastos con categoría, historial cliente, import/export CSV |

---

## 6. RECOMENDACIONES PARA ANTIGRAVITY

### Prioridad 1 — Bugs (ya corregidos, verificar)
- `generateZReport` guard — probar que el auto-cierre a las 18:15 no crashee
- Validación de stock con `(product.stock || 0)` — probar productos con stock corrupto

### Prioridad 2 — Integración de módulos (orden sugerido)
1. **`src/modules/master-styles.js`** + **`src/modules/reports.js`** → filtro fecha y cuadre de caja (bajo riesgo, valor inmediato)
2. **`src/modules/pos.js`** → cart persistente + atajos (evita pérdida de carrito)
3. **Botón anular venta** desde `funciones-pendientes.js` (necesario para operación diaria)
4. **`src/modules/dashboard.js`** + vista Inicio en HTML
5. **`src/modules/notifications.js`** → badge de alertas
6. **`src/features/multi-orden.js`** → probar con cajeros reales antes de activar
7. **`analytics-financiero.js`** → ABC, BCG, GMROI cuando se requieran reportes financieros

### Prioridad 3 — Refactors futuros
- Partir `app.js` en los archivos de `src/modules/` (strangler pattern)
- Agregar `saveCostSnapshot()` después de cada compra para que funcione la tendencia de costos
- Agregar campo `barcode` al formulario de producto (existe en datos pero no en UI)
- Considerar migrar a SQLite como almacenamiento principal en lugar de localStorage

---

*Reporte generado el 5 de julio de 2026 — Análisis sobre app.js (6914 líneas), index.html (2879 líneas), src/modules/ (5 archivos), src/features/ (2 archivos), src/renderer/ (2 archivos adicionales).*
