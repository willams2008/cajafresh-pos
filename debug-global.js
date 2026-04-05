console.log('--- GLOBAL INSPECTION ---');
console.log('Global keys:', Object.keys(global).filter(k => !k.startsWith('_')));
console.log('Process keys:', Object.keys(process).filter(k => k.includes('electron') || k.includes('app')));
process.exit(0);
