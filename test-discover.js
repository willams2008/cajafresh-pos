try {
    const electron = require('electron');
    console.log('--- DISCOVER ELECTRON ---');
    console.log('Electron value:', electron);
    console.log('Is string?', typeof electron === 'string');
    if (typeof electron === 'string') {
        console.log('String length:', electron.length);
    }
} catch (e) {
    console.log('Error discover:', e.message);
}
process.exit(0);
