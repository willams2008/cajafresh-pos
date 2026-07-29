# PLAN DE ACTUALIZACIONES — Caja Fresh POS

## Objetivo
Que puedas mandar una actualización desde tu PC y llegue automáticamente a todos los clientes sin que ellos hagan nada.

---

## Paso 1: Configurar GitHub Releases como servidor de updates

La app usará GitHub Releases para descargar los `.exe` nuevos. No necesitas VPS.

### 1a. Crear el repo en GitHub
- Ve a https://github.com/new
- Crea un repo **privado** llamado `puntopila-pos`
- No inicialices con README

### 1b. Subir el código actual
```bash
git init
git add .
git commit -m "v1.1.0"
git remote add origin https://github.com/TU_USUARIO/puntopila-pos.git
git branch -M main
git push -u origin main
```

### 1c. Generar un token de acceso
- GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
- Generate new token → marcar `repo` (acceso completo)
- Copiar el token, lo necesitas para el build automático

---

## Paso 2: Build con NSIS (instalador)

El target actual `"dir"` solo crea una carpeta. Necesitas `"nsis"` para generar un `.exe` instalador que electron-updater pueda reemplazar.

### 2a. Cambiar `package.json`
Reemplazar el bloque `"build"` por:

```json
"build": {
    "appId": "com.puntopila.pos",
    "productName": "Punto Pila POS",
    "directories": {
        "output": "dist_FINAL"
    },
    "win": {
        "target": ["nsis"],
        "icon": "icon.ico"
    },
    "nsis": {
        "oneClick": false,
        "allowToChangeInstallationDirectory": true,
        "deleteAppDataOnUninstall": false
    },
    "files": [
        "**/*",
        "!dist*/**/*",
        "!temp_*/**/*",
        "!build*/**/*",
        "!.wwebjs_cache/**/*"
    ],
    "asar": true,
    "asarUnpack": [
        "node_modules/cloudflared/**/*",
        "node_modules/ngrok/**/*"
    ],
    "publish": [
        {
            "provider": "github",
            "owner": "TU_USUARIO",
            "repo": "puntopila-pos",
            "private": true,
            "token": process.env.GH_TOKEN
        }
    ]
}
```

> Nota: `"private": true` porque el repo es privado. El token se pasa como variable de entorno `GH_TOKEN`.

### 2b. Build manual de prueba
```bash
npm install
npm run build
```
Esto genera en `dist_FINAL/`:
- `Punto Pila POS Setup X.X.X.exe`
- `Punto Pila POS Setup X.X.X.exe.blockmap`
- `latest.yml`

### 2c. Probar que el instalador funciona
Ejecutar el `.exe` generado, instalar, y verificar que la app arranca bien.

---

## Paso 3: GitHub Actions — build + release automático

Cada vez que subas un tag `v*` al repo, GitHub Actions compila la app y la publica en GitHub Releases.

### 3a. Crear `.github/workflows/release.yml`

En la raíz del proyecto crear la carpeta `.github/workflows/` con este archivo:

```yaml
name: Build & Release

on:
  push:
    tags:
      - 'v*'

jobs:
  release:
    runs-on: windows-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build
        env:
          GH_TOKEN: ${{ secrets.GH_TOKEN }}

      - name: Release
        uses: softprops/action-gh-release@v2
        with:
          files: dist_FINAL/**/*
          generate_release_notes: true
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### 3b. Configurar el secret en GitHub

- GitHub repo → Settings → Secrets and variables → Actions
- New repository secret
- Name: `GH_TOKEN`
- Secret: pegar el token que generaste en el Paso 1c

---

## Paso 4: Flujo completo para mandar una actualización

```
1. Editas código, fixes, features
2. Actualizas version en package.json (ej: 1.1.0 → 1.2.0)
3. Haces commit:
       git add .
       git commit -m "v1.2.0"
       git tag v1.2.0
       git push origin main --tags
4. GitHub Actions compila y publica el release automáticamente
5. Los clientes reciben la notificación de actualización en 30s-4h
```

---

## Resumen de archivos que tocar

| Archivo | Cambio |
|---------|--------|
| `package.json` | `"target": "nsis"`, agregar `"publish"` con GitHub |
| `main.js` | Agregar `autoUpdater` + eventos + IPC |
| `preload.js` | Exponer `onUpdateStatus`, `checkForUpdates`, etc. |
| `src/modules/auto-update.js` | Ya está creado, solo cargarlo en `index.html` |
| `.github/workflows/release.yml` | Archivo nuevo para CI/CD |

---

## Costos

- **GitHub**: $0 (repo privado, hasta 2000 min/mes de Actions gratis)
- **Certificado de firma**: $0 (puedes saltarlo, Windows mostrará advertencia pero funciona)
- **Total**: $0
