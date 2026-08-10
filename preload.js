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
    saveFile: (filename, content) => ipcRenderer.invoke('save-file', filename, content),
    showItemInFolder: (filePath) => ipcRenderer.invoke('show-item-in-folder', filePath),
    // Fiscal Printer
    writeFiscalFile: (spoolerPath, filename, content) => ipcRenderer.invoke('write-fiscal-file', spoolerPath, filename, content),
    // Auto-Updater
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    checkForUpdates: () => ipcRenderer.send('check-for-updates'),
    downloadUpdate: () => ipcRenderer.send('download-update'),
    installUpdate: () => ipcRenderer.send('install-update'),
    onUpdateStatus: (callback) => ipcRenderer.on('update-status', (event, status) => callback(status)),
    // Dashboard Remoto
    syncDashboard: (data) => ipcRenderer.send('dashboard-data', data),
    // Sunmi P3 Integration
    sunmiGetStatus: () => ipcRenderer.invoke('sunmi-get-status'),
    sunmiStartMonitoring: () => ipcRenderer.invoke('sunmi-start-monitoring'),
    sunmiStopMonitoring: () => ipcRenderer.invoke('sunmi-stop-monitoring'),
    onSunmiStatus: (callback) => ipcRenderer.on('sunmi-status', (event, data) => callback(data)),
    testPrint: () => ipcRenderer.invoke('test-print'),
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
    getSettings: () => ipcRenderer.invoke('db-get-settings'),
    getProducts: () => ipcRenderer.invoke('db-get-products'),
    saveProduct: (product) => ipcRenderer.invoke('db-save-product', product),
    saveProductsBulk: (products) => ipcRenderer.invoke('db-save-products-bulk', products),
    deleteProduct: (id) => ipcRenderer.invoke('db-delete-product', id),
    
    getClients: () => ipcRenderer.invoke('db-get-clients'),
    saveClient: (client) => ipcRenderer.invoke('db-save-client', client),
    saveCredit: (credit) => ipcRenderer.invoke('db-save-credit', credit),
    
    getSales: (limit) => ipcRenderer.invoke('db-get-sales', limit),
    getSalesByDate: (startDate, endDate) => ipcRenderer.invoke('db-get-sales-by-date', startDate, endDate),
    saveSale: (sale) => ipcRenderer.invoke('db-save-sale', sale),
    voidSale: (id) => ipcRenderer.invoke('db-void-sale', id),
    
    getCredits: () => ipcRenderer.invoke('db-get-credits'),
    addCreditPayment: (id, amount, method) => ipcRenderer.invoke('db-add-credit-payment', id, amount, method),
    
    migrateData: (data) => ipcRenderer.invoke('db-migrate', data),
    cloudSyncLog: (msg) => ipcRenderer.invoke('cloud-sync-log', msg),
    
    // Stock Transfers
    getTransfers: (status) => ipcRenderer.invoke('db-get-transfers', null, status),
    saveTransfer: (t) => ipcRenderer.invoke('db-save-transfer', t),
    updateTransferStatus: (id, status) => ipcRenderer.invoke('db-update-transfer-status', id, status),
    deleteTransfer: (id) => ipcRenderer.invoke('db-delete-transfer', id),
    
    // Purchase Orders
    getPurchaseOrders: (status) => ipcRenderer.invoke('db-get-purchase-orders', null, status),
    savePurchaseOrder: (po) => ipcRenderer.invoke('db-save-purchase-order', po),
    updatePOStatus: (id, status) => ipcRenderer.invoke('db-update-po-status', id, status),
    receivePO: (poId, items) => ipcRenderer.invoke('db-receive-po', poId, items),
    deletePO: (id) => ipcRenderer.invoke('db-delete-po', id),
    
    // Cashups / Corte Z
    getCashups: (storeId) => ipcRenderer.invoke('db-get-cashups', storeId),
    getCashupByDate: (storeId, date) => ipcRenderer.invoke('db-get-cashup-by-date', storeId, date),
    saveCashup: (storeId, cashup) => ipcRenderer.invoke('db-save-cashup', storeId, cashup),
    getTodaySalesSummary: (storeId) => ipcRenderer.invoke('db-get-today-sales-summary', storeId),

    // Movements / Merma
    getMovements: (storeId, startDate, endDate, type) => ipcRenderer.invoke('db-get-movements', storeId, startDate, endDate, type),
    saveMovement: (storeId, movement) => ipcRenderer.invoke('db-save-movement', storeId, movement),
    
    // Product Change History & Soft-Delete
    getProductChanges: (storeId, productId, limit) => ipcRenderer.invoke('db-get-product-changes', storeId, productId, limit),
    restoreProduct: (storeId, id, cashier) => ipcRenderer.invoke('db-restore-product', storeId, id, cashier),
    getDeletedProducts: (storeId) => ipcRenderer.invoke('db-get-deleted-products', storeId),
    deleteProductPermanent: (storeId, id) => ipcRenderer.invoke('db-delete-product-permanent', storeId, id),
    setMeta: (storeId, key, value) => ipcRenderer.invoke('db-set-meta', storeId, key, value),
    getMeta: (storeId, key) => ipcRenderer.invoke('db-get-meta', storeId, key),
    getProductById: (storeId, productId) => ipcRenderer.invoke('db-get-product-by-id', storeId, productId),
    
    // Users / Auth
    getUsers: () => ipcRenderer.invoke('db-get-users'),
    getUser: (username) => ipcRenderer.invoke('db-get-user', username),
    saveUser: (user) => ipcRenderer.invoke('db-save-user', user),
    deleteUser: (userId) => ipcRenderer.invoke('db-delete-user', userId),
    updateUserLastLogin: (userId) => ipcRenderer.invoke('db-update-user-last-login', userId),

    // Ingredients / Recipes (Materia Prima / Escandallos)
    getIngredients: (storeId) => ipcRenderer.invoke('db-get-ingredients', storeId),
    saveIngredient: (storeId, ingredient) => ipcRenderer.invoke('db-save-ingredient', storeId, ingredient),
    deleteIngredient: (storeId, id) => ipcRenderer.invoke('db-delete-ingredient', storeId, id),
    getRecipes: (storeId) => ipcRenderer.invoke('db-get-recipes', storeId),
    saveRecipe: (storeId, recipe) => ipcRenderer.invoke('db-save-recipe', storeId, recipe),
    deleteRecipe: (storeId, id) => ipcRenderer.invoke('db-delete-recipe', storeId, id)
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
    pushTransfer: (t) => ipcRenderer.invoke('cloud-sync-push-transfer', t),
    pushPurchaseOrder: (po) => ipcRenderer.invoke('cloud-sync-push-purchase-order', po),
    approvePurchaseOrder: (poId, items, fromStoreId) => ipcRenderer.invoke('cloud-sync-approve-po', poId, items, fromStoreId),
    receivePurchaseOrder: (poId, items, toStoreId) => ipcRenderer.invoke('cloud-sync-receive-po', poId, items, toStoreId),
    getWarehouseStoreId: () => ipcRenderer.invoke('cloud-sync-get-warehouse-store-id'),
    getWarehouseProducts: () => ipcRenderer.invoke('cloud-sync-get-warehouse-products'),
    onStatusChange: (callback) => ipcRenderer.on('cloud-sync-status', (_, data) => callback(data)),
    onProductUpdatedRemote: (callback) => ipcRenderer.on('product-updated-remote', (_, data) => callback(data)),
    onProductUpdatedRemoteFull: (callback) => ipcRenderer.on('product-updated-remote-full', (_, data) => callback(data)),
    onExchangeRateUpdatedRemote: (callback) => ipcRenderer.on('exchange-rate-updated-remote', (_, data) => callback(data)),
    addDeletedProductId: (id) => ipcRenderer.invoke('sync-add-deleted-product', id),
    removeDeletedProductId: (id) => ipcRenderer.invoke('sync-remove-deleted-product', id),
    // License Activation System
    registerMachine: (machineId, appId, deviceName, userType, userInfo) => ipcRenderer.invoke('license-register-machine', { machineId, appId, deviceName, userType, userInfo }),
    checkLicense: (machineId) => ipcRenderer.invoke('license-check-status', machineId),
    licenseHeartbeat: (machineId, version) => ipcRenderer.invoke('license-heartbeat', { machineId, version }),
    getAllLicenses: () => ipcRenderer.invoke('license-get-all'),
    updateLicense: (machineId, status, reason) => ipcRenderer.invoke('license-update-status', { machineId, status, reason })
});
