/**
 * DomainAutoDetector
 * Extracts the tenant (store_id) from the URL hostname.
 * e.g., store-name.puntopila.ve -> store_id = 'store-name'
 */
(function() {
    console.log("🔍 Running DomainAutoDetector...");
    
    const hostname = window.location.hostname;
    const parts = hostname.split('.');
    
    let storeId = null;
    
    // Handle localhost (e.g., store1.localhost)
    if (hostname === 'localhost') {
        // Fallback for direct localhost access without subdomain
        storeId = 'local_dev';
    } else if (hostname.includes('localhost') && parts.length > 1) {
        storeId = parts[0];
    } 
    // Handle production domains (e.g., elarca.puntopila.emprende.ve)
    else if (parts.length >= 4) {
        // En dominios como x.y.z.w, el primero es la sucursal
        storeId = parts[0];
    }
    else if (parts.length === 3 && !hostname.endsWith('.localhost')) {
        // Es el dominio raíz (puntopila.emprende.ve), no es una sucursal
        storeId = null;
    }

    const reserved = ['www', 'app', 'landing', 'api', 'admin', 'puntopila'];
    if (reserved.includes(storeId)) {
        storeId = null;
    }

    window.FRESH_TENANT = {
        storeId: storeId,
        hostname: hostname,
        isDetected: !!storeId
    };

    console.log("✅ Tenant Detected:", window.FRESH_TENANT);
})();
