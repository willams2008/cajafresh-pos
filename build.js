/**
 * Build Script — Caja Fresh POS
 *
 * Usa esbuild para empaquetar módulos del renderer en app.js.
 * Soporta .ts y .js en src/renderer/ y src/main/.
 *
 * Uso: node build.js
 *      npm run build:renderer
 *      npm run build:watch
 */

const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const ROOT = __dirname;

function findEntryPoint() {
    const candidates = [
        path.join(ROOT, 'src', 'renderer', 'index.ts'),
        path.join(ROOT, 'src', 'renderer', 'index.js'),
        path.join(ROOT, 'src', 'renderer', 'main.ts'),
        path.join(ROOT, 'src', 'renderer', 'main.js'),
    ];
    for (const cp of candidates) {
        if (fs.existsSync(cp)) return cp;
    }
    return null;
}

async function buildRenderer(watch = false) {
    const entryPoint = findEntryPoint();
    if (!entryPoint) {
        console.warn('[BUILD] ⚠️ Entry point no encontrado en src/renderer/');
        console.warn('[BUILD] Usando app.js existente (sin empaquetar)');
        return;
    }

    const outFile = path.join(ROOT, 'app.bundle.js');

    console.log('[BUILD] 📦 Empaquetando renderer...');
    console.log('[BUILD]   Entry:', entryPoint);
    console.log('[BUILD]   Out:  ', outFile);

    const buildOptions = {
        entryPoints: [entryPoint],
        bundle: true,
        outfile: outFile,
        platform: 'browser',
        target: ['es2020'],
        format: 'iife',
        globalName: 'CajaFresh',
        minify: false,
        sourcemap: false,
        logLevel: 'info',
        loader: {
            '.ts': 'ts',
            '.js': 'js',
        },
        external: ['electron', 'fs', 'path', 'os'],
    };

    try {
        if (watch) {
            const ctx = await esbuild.context(buildOptions);
            await ctx.watch();
            console.log('[BUILD] 👀 Watching for changes...');
        } else {
            const result = await esbuild.build(buildOptions);
            console.log('[BUILD] ✅ Renderer empaquetado exitosamente');
            const size = fs.statSync(outFile).size;
            console.log(`[BUILD]   Tamaño: ${(size / 1024).toFixed(1)} KB (${size} bytes)`);
            return result;
        }
    } catch (err) {
        console.error('[BUILD] ❌ Error empaquetando renderer:', err);
        if (!watch) process.exit(1);
    }
}

async function buildMain(watch = false) {
    const srcDir = path.join(ROOT, 'src', 'main');
    if (!fs.existsSync(srcDir)) return;

    const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.ts') || f.endsWith('.js'));
    if (files.length === 0) return;

    console.log('[BUILD] 📦 Compilando procesos principal...');

    const deps = Object.keys(require('./package.json').dependencies || {});
    const devDeps = Object.keys(require('./package.json').devDependencies || {});

    for (const file of files) {
        const inputPath = path.join(srcDir, file);
        const outFile = path.join(ROOT, file.replace(/\.ts$/, '.js'));

        try {
            if (watch) {
                const ctx = await esbuild.context({
                    entryPoints: [inputPath],
                    bundle: false,
                    outfile: outFile,
                    platform: 'node',
                    target: ['node18'],
                    format: 'cjs',
                    minify: false,
                    sourcemap: false,
                    loader: { '.ts': 'ts', '.js': 'js' },
                    external: ['electron', ...deps, ...devDeps],
                });
                await ctx.watch();
            } else {
                await esbuild.build({
                    entryPoints: [inputPath],
                    bundle: false,
                    outfile: outFile,
                    platform: 'node',
                    target: ['node18'],
                    format: 'cjs',
                    minify: false,
                    sourcemap: false,
                    loader: { '.ts': 'ts', '.js': 'js' },
                    external: ['electron', ...deps, ...devDeps],
                });
                console.log(`[BUILD]   ✅ ${file} → ${path.basename(outFile)}`);
            }
        } catch (err) {
            console.error(`[BUILD]   ❌ ${file}:`, err.message);
        }
    }
}

async function main() {
    const isWatch = process.argv.includes('--watch');

    console.log('═══════════════════════════════════════════');
    console.log('  CAJA FRESH POS — Build System');
    console.log('═══════════════════════════════════════════\n');

    await buildRenderer(isWatch);
    await buildMain(isWatch);

    if (!isWatch) {
        console.log('\n[BUILD] 🎉 Build completo.');
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
