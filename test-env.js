console.log('--- ENV CHECK ---');
console.log('Versions:', JSON.stringify(process.versions, null, 2));
try {
    const electron = require('electron');
    console.log('Electron require type:', typeof electron);
    console.log('Electron keys:', Object.keys(electron));
    console.log('App object:', typeof electron.app);
} catch (e) {
    console.log('Error requiring electron:', e.message);
}
process.exit(0);
