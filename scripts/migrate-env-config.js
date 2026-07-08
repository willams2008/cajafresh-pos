/**
 * Script de migración: Elimina valores hardcodeados de main.js
 * y los reemplaza por referencias a src/config.js.
 *
 * Uso: node scripts/migrate-env-config.js
 *
 * Este script verifica que main.js ya no contenga valores
 * hardcodeados de Supabase.
 */

const fs = require('fs');
const path = require('path');

const mainJsPath = path.join(__dirname, '..', 'main.js');

console.log('═══════════════════════════════════════════');
console.log('  Verificación de migración de config');
console.log('═══════════════════════════════════════════\n');

// Verificar 1: Que main.js use config
const content = fs.readFileSync(mainJsPath, 'utf8');
if (content.includes("require('./src/config')")) {
    console.log('✅ main.js importa src/config.js');
} else {
    console.log('❌ main.js NO importa src/config.js');
}

// Verificar 2: Que no haya Supabase hardcodeado
if (content.includes('VENDOR_SUPABASE_URL') && !content.includes('config.supabase')) {
    console.log('❌ Aún hay VENDOR_SUPABASE_URL hardcodeado');
} else {
    console.log('✅ No hay Supabase hardcodeado (usa config)');
}

// Verificar 3: Que exista .env
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
    console.log('✅ Archivo .env existe');
} else {
    console.log('❌ Archivo .env no encontrado');
}

// Verificar 4: Que .gitignore ignore .env
const gitignorePath = path.join(__dirname, '..', '.gitignore');
const gitignore = fs.readFileSync(gitignorePath, 'utf8');
if (gitignore.includes('.env')) {
    console.log('✅ .env está en .gitignore');
} else {
    console.log('⚠️ .env NO está en .gitignore');
}

// Verificar 5: Que exista tsconfig.json
const tsconfigPath = path.join(__dirname, '..', 'tsconfig.json');
if (fs.existsSync(tsconfigPath)) {
    console.log('✅ tsconfig.json existe (preparado para TS)');
} else {
    console.log('❌ tsconfig.json no encontrado');
}

// Verificar 6: Estructura src/
const srcDir = path.join(__dirname, '..', 'src');
const modules = ['config.js', 'renderer/state.js', 'renderer/utils.js', 'renderer/inventory.js', 'renderer/pos.js', 'renderer/reports.js', 'renderer/index.js'];
if (fs.existsSync(srcDir)) {
    console.log('✅ Directorio src/ existe');
    modules.forEach(m => {
        const p = path.join(srcDir, m);
        console.log(`   ${fs.existsSync(p) ? '✅' : '❌'} src/${m}`);
    });
} else {
    console.log('❌ Directorio src/ no encontrado');
}

console.log('\n═══════════════════════════════════════════');
console.log('  Migración:');
console.log('  1. Copia .env.example a .env con tus valores reales');
console.log('  2. Ejecuta: npm run build:renderer');
console.log('  3. Ejecuta: npm start');
console.log('═══════════════════════════════════════════\n');
