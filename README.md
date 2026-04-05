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

## 🔌 Tunnels y Conectividad
El sistema intenta establecer un túnel en el siguiente orden de prioridad:
1. **Cloudflare Tunnel** (Más estable, oculta contraseña).
2. **Serveo** (Fallback rápido vía SSH).
3. **Localtunnel** (Subdominio fijo: `zonafresh-pos-caja`).

## 🚨 Tips para la Próxima IA
- **Chrome Detection**: El sistema busca Chrome en rutas estándar de Windows para el motor de WhatsApp. Si falla, verifica `getChromePath()` en `main.js`.
- **Notificación de Pedidos**: El panel de pedidos móviles se activa mediante el ID `incoming-orders-panel` y la función global `window.openMobileOrdersPanel()`.
- **Precios**: Siempre verifica si el producto tiene `priceUSD` y `priceVES`. El sistema migró de un campo `price` único a campos duales.
- **Seguridad**: Los comandos de impresión (`print-ticket`) se ejecutan de forma silenciosa e "invisible" para el usuario final.

---
*Desarrollado por Zona Fresh - v1.1.0*
