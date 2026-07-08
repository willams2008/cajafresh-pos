# build_usb.ps1 - Compila Caja Fresh POS al pendrive D:\ o Localmente
$TEMP = "temp_app_build"
$SRC = $PSScriptRoot

# Detectar si el pendrive D:\ está conectado, si no, compilar localmente
if (Test-Path 'D:\') {
    $OUT = 'D:\CajaFreshPOS'
    Write-Host "📍 Pendrive D:\ detectado. Destino: $OUT"
} else {
    $OUT = "$SRC\dist_CajaFreshPOS"
    Write-Host "⚠️ Pendrive D:\ no detectado. Compilando localmente en: $OUT"
}

Write-Host "=============================================="
Write-Host " Caja Fresh POS - Compilando..."
Write-Host " Version 2.3 (licencias + cloud sync)"
Write-Host "=============================================="

# [1] Limpiar salida anterior
Write-Host "[1/7] Limpiando carpeta anterior..."
if (Test-Path $OUT) { 
    Remove-Item $OUT -Recurse -Force -ErrorAction SilentlyContinue
}
New-Item -ItemType Directory -Path $OUT -Force | Out-Null

# [2] Copiar binarios de Electron
Write-Host "[2/7] Copiando binarios de Electron..."
Copy-Item "$SRC\node_modules\electron\dist\*" $OUT -Recurse -Force

# [3] Preparar archivos fuente
Write-Host "[3/7] Preparando archivos fuente..."
if (Test-Path "$SRC\$TEMP") { 
    Remove-Item "$SRC\$TEMP" -Recurse -Force -ErrorAction SilentlyContinue
}
New-Item -ItemType Directory -Path "$SRC\$TEMP" -Force | Out-Null

$files = @("index.html","app.js","main.js","database.js","cloud-sync.js","license.js","theme.js","preload.js","style.css","activation.html","download.html","icon.png","icon.ico")
foreach ($f in $files) {
    if (Test-Path "$SRC\$f") {
        Copy-Item "$SRC\$f" "$SRC\$TEMP\" -Force
        Write-Host "  Copiado: $f"
    } else {
        Write-Host "  OMITIDO (no existe): $f"
    }
}

# Mobile
New-Item -ItemType Directory -Path "$SRC\$TEMP\mobile" -Force | Out-Null
$mobileFiles = @("index.html","app.js","manifest.json","sw.js","icon-192.png","icon-512.png","launcher.html","custom_bg.jpg","custom_bg.png")
foreach ($f in $mobileFiles) {
    if (Test-Path "$SRC\mobile\$f") { 
        Copy-Item "$SRC\mobile\$f" "$SRC\$TEMP\mobile\" -Force 
    }
}

# Landing
if (Test-Path "$SRC\landing") {
    Copy-Item "$SRC\landing" "$SRC\$TEMP\landing" -Recurse -Force
}

# Boss-multi (Panel del Jefe multi-tienda)
New-Item -ItemType Directory -Path "$SRC\$TEMP\boss-multi" -Force | Out-Null
foreach ($f in @("index.html","app.js","index.css","manifest.json","sw.js")) {
    if (Test-Path "$SRC\boss-multi\$f") { Copy-Item "$SRC\boss-multi\$f" "$SRC\$TEMP\boss-multi\" -Force }
}

# Boss (Panel del Jefe simple)
New-Item -ItemType Directory -Path "$SRC\$TEMP\boss" -Force | Out-Null
foreach ($f in @("index.html","app.js","sw.js","manifest.json")) {
    if (Test-Path "$SRC\boss\$f") { Copy-Item "$SRC\boss\$f" "$SRC\$TEMP\boss\" -Force }
}

# Cloudflared
if (Test-Path "$SRC\cloudflared.exe") {
    Copy-Item "$SRC\cloudflared.exe" "$SRC\$TEMP\" -Force
}

# package.json (copiar el estático para evitar fallos de parser)
$staticJson = Join-Path -Path $SRC -ChildPath "package_build.json"
$targetJson = Join-Path -Path "$SRC\$TEMP" -ChildPath "package.json"
Copy-Item $staticJson $targetJson -Force

# [4] npm install
Write-Host "[4/7] Instalando dependencias npm (puede tardar varios minutos)..."
Push-Location "$SRC\$TEMP"
& cmd.exe /c "npm install --production"
Pop-Location

# [5] Empaquetar en ASAR
Write-Host "[5/7] Empaquetando en ASAR..."
$asarDest = Join-Path -Path $OUT -ChildPath "resources\app.asar"
$tempPath = Join-Path -Path $SRC -ChildPath $TEMP

# Ejecutar el empaquetado asar directamente con Node para evitar problemas con la sintaxis de PowerShell y llaves {}
$nodePath = "C:\Program Files\nodejs\node.exe"
if (-not (Test-Path $nodePath)) {
    $nodePath = "node"
}
$asarPath = "$SRC\node_modules\asar\bin\asar.js"
& $nodePath $asarPath pack $tempPath $asarDest --unpack "{*.exe,*.node}"

# [5b] Copiar binarios nativos desempaquetados
Write-Host "[5b/7] Copiando binarios nativos..."
foreach ($mod in @("cloudflared","sqlite3")) {
    $modPath = Join-Path -Path $tempPath -ChildPath "node_modules\$mod"
    if (Test-Path $modPath) {
        $dest = Join-Path -Path $OUT -ChildPath "resources\app.asar.unpacked\node_modules\$mod"
        New-Item -ItemType Directory -Path $dest -Force | Out-Null
        Copy-Item "$modPath\*" $dest -Recurse -Force
        Write-Host "  Desempaquetado: $mod"
    }
}

# [6] Limpiar temporales
Write-Host "[6/7] Limpiando temporales..."
Remove-Item $tempPath -Recurse -Force -ErrorAction SilentlyContinue
$appAsarFolder = Join-Path -Path $OUT -ChildPath "resources\app"
if (Test-Path $appAsarFolder) { 
    Remove-Item $appAsarFolder -Recurse -Force -ErrorAction SilentlyContinue
}

# [7] Renombrar ejecutable
Write-Host "[7/7] Renombrando ejecutable..."
$exePath = Join-Path -Path $OUT -ChildPath "electron.exe"
if (Test-Path $exePath) {
    Rename-Item $exePath "Caja Fresh POS.exe"
} else {
    Write-Host "AVISO: electron.exe no encontrado en $OUT"
}

Write-Host ""
Write-Host "=============================================="
Write-Host " LISTO! App compilada en:"
Write-Host " $OUT\Caja Fresh POS.exe"
Write-Host "=============================================="
if (Test-Path $OUT) {
    Start-Process "explorer.exe" $OUT
}
