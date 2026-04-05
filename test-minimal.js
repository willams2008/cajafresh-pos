const { app } = require('electron');
console.log('--- TEST MINIMAL ---');
console.log('Type of app:', typeof app);
if (app) {
    console.log('App is defined correctly');
} else {
    console.log('App is UNDEFINED');
}
process.exit(0);
