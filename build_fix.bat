@echo off
title Compilando Caja Fresh POS v2.3 FIX (Precios Corregidos)...
chcp 65001 > nul

echo ==============================================
echo  Caja Fresh POS - Compilacion v2.3 FIX
echo  Correccion de precios + facturas historicas
echo ==============================================
echo.

set OUT_DIR=dist_v2.3_fix

echo [1/7] Limpiando compilacion anterior en %OUT_DIR%...
if exist "%OUT_DIR%" rmdir /s /q "%OUT_DIR%"
mkdir "%OUT_DIR%"

echo [2/7] Copiando binarios de Electron...
xcopy /E /I /Q /Y "node_modules\electron\dist\*" "%OUT_DIR%\"
if errorlevel 1 (
    echo ERROR: Fallo la copia de binarios de Electron.
    pause
    exit /b 1
)

echo [3/7] Preparando archivos fuente en temp_app_build...
if exist "temp_app_build" rmdir /s /q "temp_app_build"
mkdir "temp_app_build"

:: Archivos raiz del POS
copy /Y "index.html"       "temp_app_build\"
copy /Y "app.js"           "temp_app_build\"
copy /Y "main.js"          "temp_app_build\"
copy /Y "database.js"      "temp_app_build\"
copy /Y "cloud-sync.js"    "temp_app_build\"
copy /Y "license.js"       "temp_app_build\"
copy /Y "theme.js"         "temp_app_build\"
copy /Y "preload.js"       "temp_app_build\"
copy /Y "style.css"        "temp_app_build\"
copy /Y "activation.html"  "temp_app_build\"
copy /Y "download.html"    "temp_app_build\"
copy /Y "icon.png"         "temp_app_build\"
copy /Y "icon.ico"         "temp_app_build\"

:: Mobile app
mkdir "temp_app_build\mobile"
copy /Y "mobile\index.html"    "temp_app_build\mobile\"
copy /Y "mobile\app.js"        "temp_app_build\mobile\"
copy /Y "mobile\manifest.json" "temp_app_build\mobile\"
copy /Y "mobile\sw.js"         "temp_app_build\mobile\"
if exist "mobile\icon-192.png"   copy /Y "mobile\icon-192.png"   "temp_app_build\mobile\"
if exist "mobile\icon-512.png"   copy /Y "mobile\icon-512.png"   "temp_app_build\mobile\"
if exist "mobile\launcher.html"  copy /Y "mobile\launcher.html"  "temp_app_build\mobile\"
if exist "mobile\custom_bg.jpg"  copy /Y "mobile\custom_bg.jpg"  "temp_app_build\mobile\"
if exist "mobile\custom_bg.png"  copy /Y "mobile\custom_bg.png"  "temp_app_build\mobile\"

:: Boss-multi (Panel del Jefe multi-tienda)
mkdir "temp_app_build\boss-multi"
copy /Y "boss-multi\index.html" "temp_app_build\boss-multi\"
copy /Y "boss-multi\app.js"     "temp_app_build\boss-multi\"
copy /Y "boss-multi\index.css"  "temp_app_build\boss-multi\"
copy /Y "boss-multi\manifest.json" "temp_app_build\boss-multi\"
copy /Y "boss-multi\sw.js"      "temp_app_build\boss-multi\"

:: Boss (Panel del Jefe simple)
mkdir "temp_app_build\boss"
copy /Y "boss\index.html" "temp_app_build\boss\"
copy /Y "boss\app.js"     "temp_app_build\boss\"
copy /Y "boss\sw.js"      "temp_app_build\boss\"
copy /Y "boss\manifest.json" "temp_app_build\boss\"

:: Landing page (web accesible por clientes moviles)
if exist "landing" xcopy /E /I /Q /Y "landing\*" "temp_app_build\landing\"

:: Cloudflared binario nativo
if exist "cloudflared.exe" copy /Y "cloudflared.exe" "temp_app_build\"

:: package.json para la app empaquetada
(
  echo {
  echo   "name": "cajafresh-pos",
  echo   "version": "2.3.1",
  echo   "main": "main.js",
  echo   "dependencies": {
  echo     "express": "^5.2.1",
  echo     "socket.io": "^4.8.3",
  echo     "qrcode": "^1.5.4",
  echo     "cors": "^2.8.6",
  echo     "cloudflared": "^0.7.1",
  echo     "localtunnel": "^2.0.2",
  echo     "ngrok": "^5.0.0-beta.2",
  echo     "whatsapp-web.js": "^1.34.6",
  echo     "sqlite3": "^6.0.1"
  echo   }
  echo }
) > "temp_app_build\package.json"

echo [4/7] Instalando dependencias (esto toma unos minutos)...
cd temp_app_build
call npm.cmd install --production --prefer-offline
cd ..
if errorlevel 1 (
    echo ERROR: Fallo npm install.
    pause
    exit /b 1
)

echo [5/7] Empaquetando en ASAR...
"C:\Program Files\nodejs\node.exe" ".\node_modules\asar\bin\asar.js" pack "temp_app_build" "%OUT_DIR%\resources\app.asar" --unpack "{*.exe,*.node}"
if errorlevel 1 (
    echo ERROR: Fallo el empaquetado ASAR.
    pause
    exit /b 1
)

echo [5b/7] Copiando binarios nativos desempaquetados...
if exist "temp_app_build\node_modules\cloudflared" (
    if not exist "%OUT_DIR%\resources\app.asar.unpacked\node_modules\cloudflared" mkdir "%OUT_DIR%\resources\app.asar.unpacked\node_modules\cloudflared"
    xcopy /E /I /Q /Y "temp_app_build\node_modules\cloudflared\*" "%OUT_DIR%\resources\app.asar.unpacked\node_modules\cloudflared\"
)
if exist "temp_app_build\node_modules\sqlite3" (
    if not exist "%OUT_DIR%\resources\app.asar.unpacked\node_modules\sqlite3" mkdir "%OUT_DIR%\resources\app.asar.unpacked\node_modules\sqlite3"
    xcopy /E /I /Q /Y "temp_app_build\node_modules\sqlite3\*" "%OUT_DIR%\resources\app.asar.unpacked\node_modules\sqlite3\"
)

echo [6/7] Limpiando temporales...
rmdir /s /q "temp_app_build"
if exist "%OUT_DIR%\resources\app" rmdir /s /q "%OUT_DIR%\resources\app"

echo [7/7] Renombrando ejecutable...
rename "%OUT_DIR%\electron.exe" "Caja Fresh POS.exe"

echo.
echo ==============================================
echo  EXITO! La app v2.3.1 FIX fue compilada en:
echo  %OUT_DIR%\Caja Fresh POS.exe
echo ==============================================
echo.
start "" "%OUT_DIR%"
pause
