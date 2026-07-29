/**
 * monitor-sunmi.js - Monitorea el Sunmi P3 en busca de actividad de pago
 * 
 * USO: node monitor-sunmi.js
 * Luego procesa un pago en el Sunmi P3 y mira si detecta datos.
 */
const usb = require('usb');

let sunmiDevice = null;

async function init() {
    var devs = await usb.usb.getDevices();
    sunmiDevice = devs.find(d => d.serialNumber === 'P34425CBJ2198' || d.productName === 'P3');

    if (!sunmiDevice) {
        console.log('Sunmi P3 NO detectado. Asegurate de que este conectado por USB.');
        console.log('Dispositivos encontrados:');
        devs.forEach(d => console.log(' -', d.productName || '(sin nombre)', '| Serial:', d.serialNumber));
        return;
    }

    console.log('Sunmi P3 ENCONTRADO:');
    console.log('  Producto:', sunmiDevice.productName);
    console.log('  Serial:', sunmiDevice.serialNumber);
    console.log('');

    try {
        await sunmiDevice.open();
        console.log('Dispositivo abierto OK');

        var cfg = sunmiDevice.configurations[0];
        var iface = cfg.interfaces[0];
        var alt = iface.alternate;

        console.log('Interfaz:', alt.interfaceName || 'Sin nombre');
        console.log('Class: 0x' + alt.interfaceClass.toString(16));
        console.log('Endpoints:', alt.endpoints.length);

        var inEp = alt.endpoints.find(e => e.direction === 'in');
        var outEp = alt.endpoints.find(e => e.direction === 'out');

        if (inEp) console.log('IN endpoint addr: 0x' + inEp.bEndpointAddress.toString(16));
        if (outEp) console.log('OUT endpoint addr: 0x' + outEp.bEndpointAddress.toString(16));

        console.log('');
        console.log('Intentando claim interface...');
        try {
            iface.claim();
            console.log('Interface CLAIMED exitosamente!');
            console.log('');
            console.log('Escuchando datos del Sunmi P3...');
            console.log('AHORA procesa un pago en el terminal (ej: 0.01 Bs)');
            console.log('');

            if (inEp) {
                escucharIN(inEp);
            }

            if (outEp) {
                escucharOUT(outEp);
            }

        } catch (claimErr) {
            console.log('ERROR al hacer claim:', claimErr.message);
            console.log('(El driver WinUSB del banco ya tiene el control)');
            console.log('');
            console.log('No podemos leer datos directamente. Probemos monitorear conexion...');
            monitorearActividad();
        }
    } catch (openErr) {
        console.log('Error al abrir:', openErr.message);
    }
}

function escucharIN(ep) {
    ep.transfer(1024, function(err, data) {
        if (err) {
            console.log('IN transfer error:', err.message);
        } else if (data && data.length > 0) {
            console.log('');
            console.log('*** DATOS RECIBIDOS DEL SUNMI P3 ***');
            console.log('Bytes:', data.length);
            console.log('Hex:', data.toString('hex'));
            console.log('ASCII:', data.toString('ascii').replace(/[^\x20-\x7E]/g, '.'));
            console.log('*** POSIBLE PAGO DETECTADO! ***');
            console.log('');
            if (typeof window !== 'undefined' && window.dispatchEvent) {
                window.dispatchEvent(new CustomEvent('sunmi-pago-detectado', { detail: { raw: data.toString('hex'), texto: data.toString('ascii') } }));
            }
        }
        // Seguir escuchando
        setTimeout(function() { escucharIN(ep); }, 100);
    });
}

function escucharOUT(ep) {
    // Periodicamente intentar leer OUT tambien
    setInterval(function() {
        try {
            ep.transfer(1024, function(err, data) {
                if (data && data.length > 0) {
                    console.log('OUT data recibido:', data.toString('hex'));
                }
            });
        } catch(e) {}
    }, 2000);
}

function monitorearActividad() {
    console.log('Monitoreando cambios en el dispositivo USB...');
    var estadoAnterior = false;

    usb.usb.on('connect', function(dev) {
        console.log('Dispositivo USB conectado:', dev.productName || 'desconocido');
    });

    usb.usb.on('disconnect', function(dev) {
        console.log('Dispositivo USB desconectado:', dev.productName || 'desconocido');
    });

    // Tambien monitorear con polling
    setInterval(async function() {
        try {
            var devs = await usb.usb.getDevices();
            var encontrado = devs.some(d => d.serialNumber === 'P34425CBJ2198');
            if (encontrado !== estadoAnterior) {
                estadoAnterior = encontrado;
                console.log('Estado Sunmi cambio:', encontrado ? 'CONECTADO' : 'DESCONECTADO');
            }
        } catch(e) {}
    }, 2000);

    console.log('');
    console.log('Presiona Ctrl+C para salir.');
}

init().catch(console.error);

// Para mantener vivo el proceso
process.on('SIGINT', function() {
    console.log('\nDeteniendo monitor...');
    if (sunmiDevice) {
        try { sunmiDevice.close(); } catch(e) {}
    }
    process.exit();
});
