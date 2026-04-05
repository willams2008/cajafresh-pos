const { contextBridge, ipcRenderer } = require('electron');

// Expose safe APIs to the window object
contextBridge.exposeInMainWorld('electronAPI', {
    printTicket: () => ipcRenderer.invoke('print-ticket'),
    onServerInfo: (callback) => ipcRenderer.on('server-info', (event, info) => callback(info)),
    onIncomingOrder: (callback) => ipcRenderer.on('incoming-order', (event, order) => callback(order)),
    onRequestSync: (callback) => ipcRenderer.on('request-sync', () => callback()),
    onTunnelInfo: (callback) => ipcRenderer.on('tunnel-info', (event, info) => callback(info)),
    onRemoteQR: (callback) => ipcRenderer.on('remote-qr', (event, qr) => callback(qr)),
    onDownloadQR: (callback) => ipcRenderer.on('download-qr', (event, qr) => callback(qr)),
    onSyncStatus: (callback) => ipcRenderer.on('sync-status', (event, status) => callback(status)),
    generateQR: (url) => ipcRenderer.send('generate-remote-qr', url),
    generateDownloadQR: (url) => ipcRenderer.send('generate-download-qr', url),
    syncProducts: (products) => ipcRenderer.send('sync-products', products),
    // WhatsApp Professional APIs
    sendWhatsAppBackground: (phone, message) => ipcRenderer.invoke('whatsapp-send-report', { phone, message }),
    sendWhatsAppPDF: (phone, base64Data, filename) => ipcRenderer.invoke('whatsapp-send-pdf', { phone, base64Data, filename }),
    onWhatsAppQR: (callback) => ipcRenderer.on('whatsapp-qr', (event, qr) => callback(qr)),
    onWhatsAppStatus: (callback) => ipcRenderer.on('whatsapp-status', (event, status) => callback(status)),
    getWhatsAppStatus: () => ipcRenderer.invoke('whatsapp-get-status')
});

