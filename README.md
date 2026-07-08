# Punto Pila POS (Caja Fresh) 🚀

Punto Pila POS (anteriormente Caja Fresh) es un sistema de Punto de Venta (POS) moderno, avanzado y multi-sucursal construido sobre tecnologías web (Electron, Node.js). Está diseñado para ofrecer una experiencia rápida en la tienda, mientras sincroniza datos en la nube y provee una aplicación móvil integrada para los clientes.

## 🌟 Características Principales

*   **Punto de Venta Local (Electron):** Interfaz ultrarrápida, modo oscuro, atajos de teclado y soporte offline.
*   **Aislamiento Multi-Tenant:** Soporte nativo para múltiples sucursales (`storeId`) con bases de datos aisladas localmente (SQLite).
*   **Sincronización en la Nube (Supabase):** Respaldo automático de catálogo, ventas, estados de inventario e informes al "Dashboard del Jefe" en la nube.
*   **App Móvil / Menú Digital Integrado:** Levanta automáticamente un servidor local y lo expone a internet usando túneles (Cloudflare/Localtunnel) para que los clientes hagan pedidos desde sus teléfonos escaneando un código QR.
*   **Bot de WhatsApp Integrado:** Envía automáticamente comprobantes de pago a los clientes, reportes diarios de cierre ("Reportes Z") al jefe, y notificaciones de inventario bajo.
*   **Pagos Mixtos y Créditos:** Soporte para efectivo (USD/VES), Pago Móvil, Zelle y gestión avanzada de cuentas por cobrar (Fiaos).

## 🛠️ Stack Tecnológico

*   **Frontend (POS):** HTML5, Tailwind CSS, Vanilla JavaScript, FontAwesome.
*   **Backend:** Node.js, Express, Socket.io (para la comunicación en tiempo real con la app móvil).
*   **Desktop Wrapper:** Electron (con IPC y manipulación de procesos nativos).
*   **Base de Datos Local:** SQLite (aislado por `store_id`) y LocalStorage (Namespaced).
*   **Automatización:** `whatsapp-web.js` (Puppeteer) para el motor de WhatsApp.
*   **Generación de Reportes:** `jspdf` y `jspdf-autotable`.

---

## 🚀 Guía de Instalación y Uso

### 1. Requisitos Previos

*   **Node.js:** Versión 18.x o superior recomendada.
*   **NPM:** Viene incluido con Node.js.
*   **Google Chrome:** Necesario para el funcionamiento del bot de WhatsApp (`whatsapp-web.js` utiliza Puppeteer y requiere un navegador instalado).

### 2. Clonar / Descargar el Repositorio

Abre tu terminal y navega hasta la carpeta donde extrajiste el proyecto.

```bash
cd ruta/a/Caja-Fresh
```

### 3. Instalar Dependencias

Instala todos los módulos de Node necesarios para que la aplicación funcione.

```bash
npm install
```

### 4. Iniciar la Aplicación en Modo Desarrollo

Para correr la aplicación directamente desde el código fuente:

```bash
npm start
```
*Nota: El script `start` en `package.json` está configurado específicamente para Windows (`set ELECTRON_RUN_AS_NODE=&& electron .`). Si usas Mac/Linux, podrías necesitar ajustarlo a `ELECTRON_RUN_AS_NODE= electron .*`

---

## 📦 Compilar y Empaquetar (Build)

Si deseas generar un ejecutable `.exe` para instalar el POS en otras computadoras de Windows sin necesidad de Node.js, utiliza:

```bash
npm run package
```
Esto creará una carpeta llamada `dist` con el ejecutable nativo (`Punto Pila POS.exe`) y todos sus recursos integrados.

---

## 🔧 Configuración Adicional

### Identidad Multi-Sucursal (Multi-Tenant)
Al abrir el POS por primera vez, ve a **Menú > Identidad Sucursal**. Configura un **ID de Sucursal único** (ej. `panaderia_centro_01`). Esto creará un espacio aislado en SQLite y permitirá conectar esta máquina a la nube.

### Conexión a la Nube (Cloud Sync)
Para activar la supervisión remota, en la sección de Configuración, introduce tus credenciales de **Supabase** (`URL` y `Anon Key`). El POS empezará a enviar snapshots periódicos.

### WhatsApp Bot
1. Ve a la sección **WhatsApp AI** dentro del POS.
2. Escanea el código QR con el número de teléfono designado para el bot.
3. El motor de Puppeteer se encargará de mantener la sesión activa.

---

## 🏗️ Estructura del Proyecto

*   **`main.js`**: El corazón del backend de Electron. Controla el servidor Express, Socket.io, los túneles a internet, y el cliente de WhatsApp.
*   **`app.js`**: La lógica del Frontend principal del POS. (Carrito, Facturación, UI).
*   **`database.js`**: Interfaz de SQLite adaptada para Multi-Tenant.
*   **`cloud-sync.js`**: Cliente para comunicación REST bidireccional con Supabase.
*   **`/mobile`**: Contiene `app.js` y `index.html` para el Menú Digital al que acceden los clientes.
*   **`/boss` / `/landing`**: Aplicaciones web remotas para que el dueño ("El Jefe") supervise las ventas desde su celular.

---
### 2026-07-04 — Mantenimiento Profesional (v1.2.0)
Ver [CHANGELOG.md](./CHANGELOG.md) para el detalle completo.

- 🗑️ Limpiadas 11 carpetas de builds antiguas (`dist_*/`, `temp_*/`, `build_*/`)
- 🔐 Creado `.env.example` con todas las variables de entorno
- 🧪 Agregado ESLint, Prettier y estructura de tests
- 📁 Creado `tsconfig.json` para migración gradual a TypeScript
- 📋 Creado `CHANGELOG.md` con todos los cambios documentados
- ⚙️ Actualizado `package.json` con scripts: `lint`, `format`, `test`

**Desarrollado con ❤️ para transformar negocios.**

---

## 📋 Registro de Cambios

### 2026-06-30 — Corrección de Bugs

- **`index.html`**: Eliminado script `vendor/tesseract.min.js` que no existía en disco (causaba error 404 en cada carga).
- **`main.js`**: Reparado `startTunnelChain()` — `isStartingTunnel` nunca se reseteaba a `false` tras un túnel exitoso, bloqueando reintentos futuros.
- **`main.js`**: Eliminada ruta `/download` duplicada (líneas 910-913 y 982-984).
- **`main.js`**: Eliminado `serverApp.use('/boss', ...)` duplicado (líneas 821 y 994).
- **`app.js`**: Creada función `safeParse()` con try/catch para reemplazar todos los `JSON.parse(tenantGet(...))` sin protección (32 ocurrencias) — evitaba crasheos por datos corruptos en localStorage.
- **`app.js`**: Corregido `voidSale()` — pasaba `sale.ticket` (entero) en vez de `sale.id` (UUID), causando que nunca se anularan ventas en SQLite.
- **`app.js`**: `.catch()` vacíos ahora registran errores con `console.error` en lugar de silenciarlos (3 ocurrencias).
