try {
    const main = require('electron/main');
    console.log('--- TEST ELECTRON/MAIN ---');
    console.log('Type of app:', typeof main.app);
    process.exit(0);
} catch (e) {
    console.log('Error requiring electron/main:', e.message);
    process.exit(1);
}
