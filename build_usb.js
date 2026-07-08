const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log("==============================================");
console.log(" Caja Fresh POS - Compilando con Node.js...");
console.log("==============================================");

const SRC = __dirname;
const TEMP = path.join(SRC, 'temp_app_build');

// Detectar destino: D:\ o Local
let OUT = path.join(SRC, 'dist_CajaFreshPOS');
if (fs.existsSync('D:\\')) {
    OUT = 'D:\\CajaFreshPOS';
    console.log(`📍 Pendrive D:\\ detectado. Destino: ${OUT}`);
} else {
    console.log(`⚠️ Pendrive D:\\ no detectado. Compilando localmente en: ${OUT}`);
}

// Función recursiva de copiado para máxima compatibilidad
function copyRecursiveSync(src, dest) {
    const exists = fs.existsSync(src);
    const stats = exists && fs.statSync(src);
    const isDirectory = exists && stats.isDirectory();
    if (isDirectory) {
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
        }
        fs.readdirSync(src).forEach((childItemName) => {
            copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
        });
    } else {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
    }
}

try {
    // 1. Limpiar salida anterior
    console.log("[1/7] Limpiando carpeta anterior...");
    if (fs.existsSync(OUT)) {
        fs.rmSync(OUT, { recursive: true, force: true });
    }
    fs.mkdirSync(OUT, { recursive: true });

    // 2. Copiar binarios de Electron
    console.log("[2/7] Copiando binarios de Electron...");
    const electronDist = path.join(SRC, 'node_modules', 'electron', 'dist');
    if (fs.existsSync(electronDist)) {
        copyRecursiveSync(electronDist, OUT);
    } else {
        throw new Error("No se encontraron los binarios de Electron en node_modules/electron/dist");
    }

    // 3. Preparar archivos fuente
    console.log("[3/7] Preparando archivos fuente...");
    if (fs.existsSync(TEMP)) {
        fs.rmSync(TEMP, { recursive: true, force: true });
    }
    fs.mkdirSync(TEMP, { recursive: true });

    // Copiar archivos principales
    const mainFiles = [
        "index.html", "app.js", "main.js", "database.js", "cloud-sync.js",
        "license.js", "theme.js", "preload.js", "style.css", "activation.html",
        "download.html", "icon.png", "icon.ico"
    ];
    mainFiles.forEach(file => {
        const srcPath = path.join(SRC, file);
        if (fs.existsSync(srcPath)) {
            fs.copyFileSync(srcPath, path.join(TEMP, file));
            console.log(`  Copiado: ${file}`);
        } else {
            console.log(`  OMITIDO (no existe): ${file}`);
        }
    });

    // Copiar carpeta mobile
    const mobileSrc = path.join(SRC, 'mobile');
    if (fs.existsSync(mobileSrc)) {
        fs.mkdirSync(path.join(TEMP, 'mobile'), { recursive: true });
        const mobileFiles = [
            "index.html", "app.js", "manifest.json", "sw.js", 
            "icon-192.png", "icon-512.png", "launcher.html", 
            "custom_bg.jpg", "custom_bg.png"
        ];
        mobileFiles.forEach(file => {
            const srcPath = path.join(mobileSrc, file);
            if (fs.existsSync(srcPath)) {
                fs.copyFileSync(srcPath, path.join(TEMP, 'mobile', file));
            }
        });
    }

    // Copiar carpeta landing
    const landingSrc = path.join(SRC, 'landing');
    if (fs.existsSync(landingSrc)) {
        copyRecursiveSync(landingSrc, path.join(TEMP, 'landing'));
    }

    // Copiar cloudflared.exe
    const cfExe = path.join(SRC, 'cloudflared.exe');
    if (fs.existsSync(cfExe)) {
        fs.copyFileSync(cfExe, path.join(TEMP, 'cloudflared.exe'));
    }

    // Copiar package.json estático
    const staticJson = path.join(SRC, 'package_build.json');
    if (fs.existsSync(staticJson)) {
        fs.copyFileSync(staticJson, path.join(TEMP, 'package.json'));
    } else {
        throw new Error("No se encuentra package_build.json en la raíz");
    }

    // 4. Instalar dependencias npm
    console.log("[4/7] Instalando dependencias npm (modo producción)...");
    execSync('npm install --production', { cwd: TEMP, stdio: 'inherit' });

    // 5. Empaquetar en ASAR
    console.log("[5/7] Empaquetando en ASAR...");
    const asarDest = path.join(OUT, 'resources', 'app.asar');
    const asarBin = path.join(SRC, 'node_modules', 'asar', 'bin', 'asar.js');
    execSync(`node "${asarBin}" pack "${TEMP}" "${asarDest}" --unpack "{*.exe,*.node}"`, { stdio: 'inherit' });

    // 5b. Copiar binarios nativos
    console.log("[5b/7] Copiando binarios nativos desempaquetados...");
    const nativeModules = ['cloudflared', 'sqlite3'];
    nativeModules.forEach(mod => {
        const modPath = path.join(TEMP, 'node_modules', mod);
        if (fs.existsSync(modPath)) {
            const destPath = path.join(OUT, 'resources', 'app.asar.unpacked', 'node_modules', mod);
            copyRecursiveSync(modPath, destPath);
            console.log(`  Desempaquetado: ${mod}`);
        }
    });

    // 6. Limpiar temporales
    console.log("[6/7] Limpiando temporales...");
    fs.rmSync(TEMP, { recursive: true, force: true });
    const appFolder = path.join(OUT, 'resources', 'app');
    if (fs.existsSync(appFolder)) {
        fs.rmSync(appFolder, { recursive: true, force: true });
    }

    // 7. Renombrar ejecutable
    console.log("[7/7] Renombrando ejecutable...");
    const oldExe = path.join(OUT, 'electron.exe');
    const newExe = path.join(OUT, 'Caja Fresh POS.exe');
    if (fs.existsSync(oldExe)) {
        fs.renameSync(oldExe, newExe);
    } else {
        console.log(`⚠️ electron.exe no encontrado en ${OUT}`);
    }

    console.log("\n==============================================");
    console.log(" ¡LISTO! Aplicación compilada con éxito en:");
    console.log(` ${newExe}`);
    console.log("==============================================");

    // Abrir explorador
    try {
        execSync(`explorer.exe "${OUT}"`);
    } catch(e) {
        // Ignorar error al abrir explorador
    }

} catch(err) {
    console.error("\n❌ ERROR DURANTE LA COMPILACIÓN:");
    console.error(err.message);
    process.exit(1);
}
