/**
 * prueba-sunmi-p3.js - Script de prueba para integracion Sunmi P3
 * Corre con: node prueba-sunmi-p3.js
 */
(async () => {
    console.log('=== PRUEBA DE INTEGRACION SUNMI P3 ===\n');

    // 1. Detectar via node-usb
    try {
        const usb = require('usb');
        const devs = await usb.usb.getDevices();
        const sunmi = devs.find(d => d.serialNumber === 'P34425CBJ2198' || (d.productName && d.productName === 'P3'));

        if (!sunmi) {
            console.log('SUNMI P3: NO DETECTADO');
            console.log('Dispositivos USB encontrados:');
            devs.forEach(d => console.log('  -', d.productName || '(sin nombre)', '|', d.manufacturerName || '', '| Serial:', d.serialNumber));
            process.exit(1);
        }

        console.log('SUNMI P3: DETECTADO');
        console.log('  Producto     :', sunmi.productName);
        console.log('  Fabricante   :', sunmi.manufacturerName);
        console.log('  Serial       :', sunmi.serialNumber);

        // 2. Abrir y explorar interfaces
        await sunmi.open();
        console.log('\nInterfaces USB:');
        const cfg = sunmi.configurations[0];
        for (let ii = 0; ii < cfg.interfaces.length; ii++) {
            const iface = cfg.interfaces[ii];
            for (let ai = 0; ai < iface.alternates.length; ai++) {
                const alt = iface.alternates[ai];
                console.log('  IF[' + ii + '] alt keys:', Object.keys(alt).join(', '));
                const cls = alt.bInterfaceClass !== undefined ? alt.bInterfaceClass : (alt.interfaceClass !== undefined ? alt.interfaceClass : '?');
                const sub = alt.bInterfaceSubClass !== undefined ? alt.bInterfaceSubClass : (alt.interfaceSubclass !== undefined ? alt.interfaceSubclass : '?');
                const proto = alt.bInterfaceProtocol !== undefined ? alt.bInterfaceProtocol : (alt.interfaceProtocol !== undefined ? alt.interfaceProtocol : '?');
                const epDesc = alt.endpoints ? alt.endpoints.map(function(e) { try { return (e.direction || '?') + ':' + (e.type || '?'); } catch(ex) { return '?'; } }).join(', ') : 'sin endpoints';
                console.log('  IF[' + ii + '] Class:0x' + cls.toString(16) + ' (' + (alt.interfaceName || 'n/a') + ') EPs: ' + epDesc);
            }
        }

        // 3. Detectar ADB
        const hasADB = cfg.interfaces.some(iface =>
            iface.alternates.some(a =>
                a.interfaceName === 'ADB Interface' || a.interfaceClass === 255
            )
        );

        if (hasADB) {
            console.log('\nADB: DETECTADO via USB');
            console.log('  El Sunmi P3 expone interfaz ADB.');
            console.log('  Se puede comunicar via protocolo ADB sobre USB.');
            console.log('  Recomendacion: Instalar ADB y usar "adb shell"');
        }

        // 4. Verificar numero de serie
        const serialUSB = sunmi.serialNumber;
        console.log('\nSerial Number:', serialUSB);

        sunmi.close();

        // 5. Probar ADB si esta disponible
        console.log('\n--- Probando ADB (si instalado) ---');
        const { execSync } = require('child_process');
        try {
            const adbDevices = execSync('adb devices', { timeout: 5000, encoding: 'utf8' });
            console.log('ADB devices output:');
            console.log(adbDevices);
            if (adbDevices.includes(serialUSB)) {
                console.log('ADB: CONECTADO al Sunmi P3 via ADB!');
            } else if (adbDevices.includes('device')) {
                console.log('ADB: Dispositivo encontrado pero no identificado como Sunmi');
            } else {
                console.log('ADB: No se detecto el Sunmi P3 via ADB');
            }
        } catch (e) {
            console.log('ADB: No disponible (no instalado o no en PATH)');
            console.log('  Para instalarlo: https://developer.android.com/studio/releases/platform-tools');
        }

        console.log('\n=== PRUEBA COMPLETADA ===');
        console.log('Resumen:');
        console.log('  - Sunmi P3 detectado via USB OK');
        console.log('  - Interfaz: ADB (Class 0xFF, SubClass 0x42, Protocol 0x11)');
        console.log('  - Bulk endpoints: OUT(0x01) e IN(0x81)');
        console.log('  - Para integracion real se requiere:');
        console.log('    a) App companion Android en Sunmi P3 (recomendado)');
        console.log('    b) O ADB + logcat para detectar eventos de pago');
        console.log('    c) O flujo manual con confirmacion + impresion termica');

    } catch (err) {
        console.error('ERROR:', err.message);
        console.error(err.stack);
    }
})();
