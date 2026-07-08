@echo off
title Compilando Caja Fresh POS v2.2 - FIX TÚNEL & APK...

echo ==============================================
echo  Caja Fresh POS - Compilacion v2.2
echo  Con mejoras de busqueda y categorias
echo ==============================================
echo.

set OUT_DIR=dist_v2.2

echo Paso 1: Limpiando compilacion anterior en %OUT_DIR%...
if exist "%OUT_DIR%" rmdir /s /q "%OUT_DIR%"
mkdir "%OUT_DIR%"

echo Paso 2: Copiando binarios de Electron...
xcopy /E /I /Q /Y "node_modules\electron\dist\*" "%OUT_DIR%\"

echo Paso 3: Preparando archivos temporales...
if exist "temp_app" rmdir /s /q "temp_app"
mkdir "temp_app"
copy /Y "index.html"   "temp_app\"
copy /Y "app.js"       "temp_app\"
copy /Y "main.js"      "temp_app\"
copy /Y "database.js"  "temp_app\"
copy /Y "cloud-sync.js" "temp_app\"
copy /Y "license.js"   "temp_app\"
copy /Y "theme.js"     "temp_app\"
copy /Y "preload.js"   "temp_app\"
copy /Y "style.css"    "temp_app\"
copy /Y "activation.html" "temp_app\"
copy /Y "download.html"   "temp_app\"
copy /Y "icon.png"     "temp_app\"
mkdir "temp_app\mobile"
copy /Y "mobile\index.html" "temp_app\mobile\"
copy /Y "mobile\app.js"     "temp_app\mobile\"
copy /Y "mobile\manifest.json" "temp_app\mobile\"
copy /Y "mobile\sw.js"      "temp_app\mobile\"
if exist "mobile\icon-192.png" copy /Y "mobile\icon-192.png" "temp_app\mobile\"
if exist "mobile\icon-512.png" copy /Y "mobile\icon-512.png" "temp_app\mobile\"
if exist "mobile\launcher.html" copy /Y "mobile\launcher.html" "temp_app\mobile\"
mkdir "temp_app\boss-multi"
copy /Y "boss-multi\index.html" "temp_app\boss-multi\"
copy /Y "boss-multi\app.js"     "temp_app\boss-multi\"
copy /Y "boss-multi\index.css"  "temp_app\boss-multi\"
copy /Y "boss-multi\manifest.json" "temp_app\boss-multi\"
copy /Y "boss-multi\sw.js"      "temp_app\boss-multi\"
mkdir "temp_app\boss"
copy /Y "boss\index.html" "temp_app\boss\"
copy /Y "boss\app.js"     "temp_app\boss\"
copy /Y "boss\sw.js"      "temp_app\boss\"
copy /Y "boss\manifest.json" "temp_app\boss\"

(
  echo {
  echo   "name": "cajafresh-pos",
  echo   "version": "2.2.0",
  echo   "main": "main.js",
  echo   "dependencies": {
  echo     "express": "^5.2.1",
  echo     "socket.io": "^4.8.3",
  echo     "qrcode": "^1.5.4",
  echo     "cors": "^2.8.6",
  echo     "cloudflared": "^0.7.1",
  echo     "localtunnel": "^2.0.2",
  echo     "ngrok": "^5.0.0-beta.2",
  echo     "whatsapp-web.js": "^1.34.6"
  echo   }
  echo }
) > "temp_app\package.json"

echo Paso 3.5: Instalando dependencias en la app empaquetada...
cd temp_app
call npm install --production
cd ..

echo Paso 4: Empaquetando en ASAR (con unpack para cloudflared)...
"C:\Program Files\nodejs\node.exe" ".\node_modules\asar\bin\asar.js" pack "temp_app" "%OUT_DIR%\resources\app.asar" --unpack "{*.exe,*.node}"

echo Paso 5: Desempaquetando binarios nativos de cloudflared...
if exist "temp_app\node_modules\cloudflared" (
    echo Copiando cloudflared a app.asar.unpacked...
    if not exist "%OUT_DIR%\resources\app.asar.unpacked\node_modules\cloudflared" mkdir "%OUT_DIR%\resources\app.asar.unpacked\node_modules\cloudflared"
    xcopy /E /I /Q /Y "temp_app\node_modules\cloudflared\*" "%OUT_DIR%\resources\app.asar.unpacked\node_modules\cloudflared\"
)

echo Paso 6: Limpiando temporales...
rmdir /s /q "temp_app"
if exist "%OUT_DIR%\resources\app" rmdir /s /q "%OUT_DIR%\resources\app"

echo Paso 7: Renombrando ejecutable...
rename "%OUT_DIR%\electron.exe" "Caja Fresh POS.exe"

echo.
echo ==============================================
echo  EXITO! La aplicacion v2.2 fue compilada en:
echo  %OUT_DIR%\Caja Fresh POS.exe
echo ==============================================
echo.
echo Abriendo la carpeta de la aplicacion...
start "" "%OUT_DIR%"
