# 📦 Caja Fresh POS - Sistema Punto de Venta Premium

> **Nota para el Asistente de IA:** Este README ha sido diseñado para que entiendas rápidamente la arquitectura, el flujo de datos y las dependencias críticas de este proyecto.

## 🎯 Visión General
**Caja Fresh** es un sistema POS (Point of Sale) de escritorio construido con **Electron** para el mercado venezolano. Sus pilares son la rapidez, la integración total con **WhatsApp** y un ecosistema de **pedidos móviles** en tiempo real.

## 🛠️ Arquitectura Técnica
El proyecto sigue un patrón de procesos divididos:

1.  **Proceso Principal (`main.js`)**: 
    - Inicia un servidor **Express** (puerto 3000) para la App Móvil.
    - Gestiona túneles remotos (**Cloudflare**, **Serveo**, **Localtunnel**).
    - Controla el motor de **WhatsApp Web** (`whatsapp-web.js`) con autenticación local.
    - Maneja la sincronización vía **Socket.io**.
    - Descubrimiento de red mediante **ntfy.sh**.

2.  **Proceso de Renderizado (Frontend - `app.js`)**:
    - Lógica de estado global (productos, carrito, ventas, clientes).
    - Gestión de precios duales (**VES/USD**) con tasa ajustable.
    - **OCR Inteligente** para carga de facturas de proveedores (Sabores, Polar, Coca-Cola).
    - Generación de reportes PDF y tickets.

3.  **App Móvil (`mobile/`)**:
    - Aplicación web estática servida por Express.
    - Comunicación bidireccional con la caja vía WebSockets.

## 🔑 Componentes Críticos del Código

### Datos y Persistencia
- Se utiliza principalmente **`localStorage`** para el estado de la aplicación (`freshpos_products`, `freshpos_sales`, `freshpos_settings`, etc.).
- Las sesiones de WhatsApp se guardan en el directorio `.wwebjs_cache/`.

### Lógica de Negocio (Venezuela-Specific)
- **Tasa de Cambio**: Sincronizada globalmente. Cambiar la tasa recalcula automáticamente los precios en el inventario y el carrito.
- **Redondeo VES**: Los precios en Bolívares se redondean a la decena más cercana (ej. 1234 -> 1230 o 1240) para facilitar el manejo de efectivo.
- **Cierre de Caja**: Automatizado a las **18:15**. Se genera un reporte "Z" y se resetean los datos del día si hay ventas.

### Integración de IA (OCR)
- Ubicada en la vista de "Carga Surtidor" (`view-purchases`).
- Permite mapear texto detectado en fotos de facturas físicas directamente a productos del inventario, gestionando costos y stock de forma masiva.

### Gestión de Entregas y Despacho
- **Entregas App (`nav-mobile-deliveries`)**: Módulo de despacho que permite gestionar pedidos móviles entrantes. Incluye verificación de pago, visualización de productos y despacho final que deduce stock y registra la venta en el historial.

### Automatización de Pago Móvil
- **Motor Universal de Detección**: Implementado en `main.js` (`parseSMSPayment`), utiliza heurística para detectar montos y referencias de cualquier banco venezolano (Bancaribe, Banesco, etc.) en correos, SMS o WhatsApp.
- **Enlace Gmail Autónomo**: Integrable mediante Google Apps Script. El puente busca automáticamente el túnel activo de la caja (vía `ntfy.sh`) y reenvía los correos del banco en tiempo real sin intervención manual.

## 🔌 Tunnels y Conectividad
El sistema intenta establecer un túnel en el siguiente orden de prioridad:
1. **Cloudflare Tunnel** (Más estable, URL tipo `trycloudflare.com`).
2. **Serveo** (Fallback rápido vía SSH).
3. **Localtunnel** (Subdominio fijo: `zonafresh-pos-caja`).

## 🚨 Tips para la Próxima IA
- **Detección de Pagos**: Si un pago no entra, verifica los logs en la consola del proceso principal (`main.js`). El motor universal es sensible a los formatos de decimales (usa `,`).
- **Sync con Gmail**: El ID de ntfy para el descubrimiento de la URL es `zonafresh_caja_pos_tunnel_url_secret_eb6044`.
- **Precios en Entregas**: El módulo de entregas utiliza `item.priceVES || (item.priceUSD * exchangeRate)` para garantizar que los pedidos creados manualmente en la caja se vean correctamente.
- **Chrome Detection**: El sistema busca Chrome en rutas estándar de Windows para el motor de WhatsApp. Si falla, verifica `getChromePath()` en `main.js`.
- **Notificación de Pedidos**: El panel de pedidos móviles se activa mediante el ID `incoming-orders-panel` y la función global `window.openMobileOrdersPanel()`.
- **Precios**: Siempre verifica si el producto tiene `priceUSD` y `priceVES`. El sistema migró de un campo `price` único a campos duales.
- **Seguridad**: Los comandos de impresión (`print-ticket`) se ejecutan de forma silenciosa e "invisible" para el usuario final.

---

## 🚧 Trabajo en Progreso y Pendientes

Actualmente el sistema está en fase de despliegue de las últimas automatizaciones. Pendiente por revisar:

1.  **Estabilidad de Túneles**: Verificar que el proceso de conexión no se quede en "Conectando" indefinidamente. Si Cloudflare falla, el sistema debe caer correctamente en Serveo.
2.  **Prueba de Fuego Gmail**: Realizar una prueba con un correo de banco real (no simulado) para confirmar que el script de Google Apps Script captura los datos y los entrega a la caja.
3.  **Feedback Visual de Pagos**: Mejorar el modal de "Pago Detectado" para que muestre el banco detectado y permita "Vincular" el pago a una orden específica en espera.
4.  **Refresco Automático de Entregas**: Confirmar que la lista de "Entregas App" se actualice en tiempo real sin necesidad de cambiar de pestaña cuando llegue un pedido nuevo.

---
*Ultima actualización: Abril 2026 - v1.1.5*
