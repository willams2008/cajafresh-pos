/**
 * integracion-sunmi.js - Monitoreo del Sunmi P3 por USB
 * Para usar desde Electron (main process)
 * 
 * Uso: const sunmi = require('./integracion-sunmi');
 * sunmi.iniciarMonitoreo();
 * sunmi.on('pago-detectado', (data) => { ... });
 */
const EventEmitter = require('events');
const usb = require('usb');

class SunmiP3 extends EventEmitter {
    constructor() {
        super();
        this.device = null;
        this.conectado = false;
        this.intentos = 0;
        this.SERIAL = 'P34425CBJ2198';
        this.VENDOR_ID = 0x0E8D;
        this.PRODUCT_ID = 0x201C;
        this._monitoreando = false;
    }

    async detectar() {
        try {
            const devs = await usb.usb.getDevices();
            this.device = devs.find(d =>
                d.serialNumber === this.SERIAL ||
                (d.productName && d.productName === 'P3')
            );

            if (this.device) {
                if (!this.conectado) {
                    this.conectado = true;
                    console.log('[Sunmi] Dispositivo conectado:', this.device.productName, this.device.serialNumber);
                    this.emit('conectado', {
                        producto: this.device.productName,
                        fabricante: this.device.manufacturerName,
                        serial: this.device.serialNumber
                    });
                }
                return true;
            } else {
                if (this.conectado) {
                    this.conectado = false;
                    console.log('[Sunmi] Dispositivo desconectado');
                    this.emit('desconectado');
                }
                return false;
            }
        } catch (err) {
            console.error('[Sunmi] Error al detectar:', err.message);
            return false;
        }
    }

    iniciarMonitoreo(intervaloMs = 3000) {
        if (this._monitoreando) return;
        this._monitoreando = true;

        // Detectar inmediatamente
        this.detectar();

        // Monitorear cada N segundos
        this._interval = setInterval(() => this.detectar(), intervaloMs);

        // Escuchar eventos de conexion/desconexion USB
        try {
            usb.usb.on('connect', (dev) => {
                if (dev.serialNumber === this.SERIAL || dev.productName === 'P3') {
                    this.detectar();
                }
            });
            usb.usb.on('disconnect', (dev) => {
                if (dev.serialNumber === this.SERIAL || dev.productName === 'P3') {
                    this.detectar();
                }
            });
        } catch (e) {
            console.log('[Sunmi] Eventos USB no soportados en esta version');
        }

        console.log('[Sunmi] Monitoreo iniciado (cada ' + intervaloMs / 1000 + 's)');
    }

    detenerMonitoreo() {
        this._monitoreando = false;
        if (this._interval) {
            clearInterval(this._interval);
            this._interval = null;
        }
        console.log('[Sunmi] Monitoreo detenido');
    }

    async enviarComandoADB(comando) {
        if (!this.conectado) {
            throw new Error('Sunmi P3 no conectado');
        }
        // TODO: Implementar protocolo ADB sobre USB
        throw new Error('ADB protocolo no implementado aun');
    }
}

module.exports = new SunmiP3();

// Si se ejecuta directamente:
if (require.main === module) {
    const sunmi = new SunmiP3();
    sunmi.on('conectado', (d) => console.log('CONECTADO:', JSON.stringify(d, null, 2)));
    sunmi.on('desconectado', () => console.log('DESCONECTADO'));

    (async () => {
        console.log('Detectando Sunmi P3...');
        const encontrado = await sunmi.detectar();
        console.log('Estado:', encontrado ? 'CONECTADO' : 'NO ENCONTRADO');

        if (encontrado) {
            console.log('\nInformacion del dispositivo:');
            console.log('  Nombre:', sunmi.device.productName);
            console.log('  Fabricante:', sunmi.device.manufacturerName);
            console.log('  Serial:', sunmi.device.serialNumber);
        }

        // Monitorear cambios
        sunmi.iniciarMonitoreo(5000);
        console.log('\nMonitoreando cambios USB... (Ctrl+C para salir)');

        // Mantener vivo
        process.on('SIGINT', () => {
            sunmi.detenerMonitoreo();
            process.exit();
        });
    })();
}
