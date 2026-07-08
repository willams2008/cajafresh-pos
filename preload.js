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
    sendWASaleAlert: (phone, sale, dailyTotal) => ipcRenderer.invoke('whatsapp-sale-alert', { phone, sale, dailyTotal }),
    onWhatsAppQR: (callback) => ipcRenderer.on('whatsapp-qr', (event, qr) => callback(qr)),
    onWhatsAppStatus: (callback) => ipcRenderer.on('whatsapp-status', (event, status) => callback(status)),
    getWhatsAppStatus: () => ipcRenderer.invoke('whatsapp-get-status'),
    initWhatsApp: () => ipcRenderer.invoke('whatsapp-init'),
    logoutWhatsApp: () => ipcRenderer.invoke('whatsapp-logout'),
    onPaymentDetected: (callback) => ipcRenderer.on('payment-detected', (event, payment) => callback(payment)),
    requestDiscoveryUpdate: () => ipcRenderer.send('request-discovery-update'),
    requestTunnelInfo: () => ipcRenderer.send('request-tunnel-info'),
    saveData: (data) => ipcRenderer.invoke('save-data', data),
    loadData: (data) => ipcRenderer.invoke('load-data', data),
    restartTunnels: () => ipcRenderer.send('restart-tunnels'),
    onProductUpdatedRemote: (callback) => ipcRenderer.on('product-updated-remote', (event, product) => callback(product)),
    onProductUpdatedRemoteFull: (callback) => ipcRenderer.on('product-updated-remote-full', (event, product) => callback(product)),
    onRemotePriceUpdated: (callback) => ipcRenderer.on('remote-price-updated', (event, data) => callback(data)),
    // License System
    activateLicense: (key, storeName) => ipcRenderer.invoke('license-activate', key, storeName),
    licenseActivated: () => ipcRenderer.send('license-activated'),
    getMachineId: () => ipcRenderer.invoke('license-get-id'),
    getLicenseStatus: () => ipcRenderer.invoke('license-get-status'),
    openActivation: () => ipcRenderer.send('open-activation'),
    licenseForceCheck: () => ipcRenderer.invoke('license-force-check'),
    getPublicIP: () => ipcRenderer.invoke('get-public-ip'),
    selectMobileBg: () => ipcRenderer.invoke('select-mobile-bg'),
    exportToPDF: () => ipcRenderer.invoke('export-to-pdf'),
    // Fiscal Printer
    writeFiscalFile: (spoolerPath, filename, content) => ipcRenderer.invoke('write-fiscal-file', spoolerPath, filename, content),
    // Dashboard Remoto
    syncDashboard: (data) => ipcRenderer.send('dashboard-data', data),
    send: (channel, data) => {
        const validChannels = ['dashboard-data', 'sync-products', 'generate-remote-qr', 'generate-download-qr', 'request-discovery-update', 'request-tunnel-info', 'license-activated'];
        if (validChannels.includes(channel)) ipcRenderer.send(channel, data);
    },
    on: (channel, callback) => {
        const validChannels = [
            'product-updated-remote-full', 
            'exchange-rate-updated-remote', 
            'remote-price-updated', 
            'incoming-order', 
            'payment-detected',
            'whatsapp-qr',
            'whatsapp-status',
            'catalog-pulled-from-cloud'
        ];
        if (validChannels.includes(channel)) {
            ipcRenderer.on(channel, (event, ...args) => callback(...args));
        }
    }
});

contextBridge.exposeInMainWorld('db', {
    getProducts: () => ipcRenderer.invoke('db-get-products'),
    saveProduct: (product) => ipcRenderer.invoke('db-save-product', product),
    saveProductsBulk: (products) => ipcRenderer.invoke('db-save-products-bulk', products),
    deleteProduct: (id) => ipcRenderer.invoke('db-delete-product', id),
    
    getClients: () => ipcRenderer.invoke('db-get-clients'),
    saveClient: (client) => ipcRenderer.invoke('db-save-client', client),
    
    getSales: (limit) => ipcRenderer.invoke('db-get-sales', limit),
    getSalesByDate: (startDate, endDate) => ipcRenderer.invoke('db-get-sales-by-date', startDate, endDate),
    saveSale: (sale) => ipcRenderer.invoke('db-save-sale', sale),
    voidSale: (id) => ipcRenderer.invoke('db-void-sale', id),
    
    getCredits: () => ipcRenderer.invoke('db-get-credits'),
    addCreditPayment: (id, amount, method) => ipcRenderer.invoke('db-add-credit-payment', id, amount, method),
    
    migrateData: (data) => ipcRenderer.invoke('db-migrate', data),
    cloudSyncLog: (msg) => ipcRenderer.invoke('cloud-sync-log', msg)
});

// --- CLOUD SYNC (Multi-Sucursal) ---
contextBridge.exposeInMainWorld('cloudSync', {
    configure: (cfg) => ipcRenderer.invoke('cloud-sync-configure', cfg),
    getStatus: () => ipcRenderer.invoke('cloud-sync-status'),
    pushSale: (sale) => ipcRenderer.invoke('cloud-sync-push-sale', sale),
    pushExpense: (expense) => ipcRenderer.invoke('cloud-sync-push-expense', expense),
    pushAlerts: (products) => ipcRenderer.invoke('cloud-sync-push-alerts', products),
    pushLiveState: (cart, totals, view) => ipcRenderer.invoke('cloud-sync-push-live', cart, totals, view),
    pushCatalog: (products) => ipcRenderer.invoke('cloud-sync-push-catalog', products),
    onStatusChange: (callback) => ipcRenderer.on('cloud-sync-status', (_, data) => callback(data)),
    onProductUpdatedRemote: (callback) => ipcRenderer.on('product-updated-remote', (_, data) => callback(data)),
    onProductUpdatedRemoteFull: (callback) => ipcRenderer.on('product-updated-remote-full', (_, data) => callback(data)),
    onExchangeRateUpdatedRemote: (callback) => ipcRenderer.on('exchange-rate-updated-remote', (_, data) => callback(data))
});
