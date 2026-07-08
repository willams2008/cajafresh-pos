@echo off
title Compilando Caja Fresh POS v1.1.0 White Label...
echo ==============================================
echo  Caja Fresh POS - Compilacion v1.1.0
echo  (Edición Especial Marca Blanca / White Label)
echo ==============================================
echo.

set OUT_DIR=dist_v1.1.0_WhiteLabel

echo Paso 1: Limpiando compilacion anterior en %OUT_DIR%...
if exist "%OUT_DIR%" rmdir /s /q "%OUT_DIR%"
mkdir "%OUT_DIR%"

echo Paso 2: Copiando binarios de Electron...
xcopy /E /I /Q /Y "node_modules\electron\dist\*" "%OUT_DIR%\"

echo Paso 3: Preparando archivos temporales...
if exist "temp_app" rmdir /s /q "temp_app"
mkdir "temp_app"
copy /Y "index.html" "temp_app\"
copy /Y "app.js"     "temp_app\"
copy /Y "main.js"    "temp_app\"
copy /Y "database.js" "temp_app\"
copy /Y "cloud-sync.js" "temp_app\"
copy /Y "license.js" "temp_app\"
copy /Y "theme.js"   "temp_app\"
copy /Y "preload.js" "temp_app\"
copy /Y "style.css"  "temp_app\"
copy /Y "activation.html" "temp_app\"
copy /Y "download.html"   "temp_app\"
copy /Y "icon.png"   "temp_app\"
copy /Y "lanzar_tunel.bat" "temp_app\"
mkdir "temp_app\mobile"
copy /Y "mobile\index.html" "temp_app\mobile\"
copy /Y "mobile\app.js"     "temp_app\mobile\"
copy /Y "mobile\manifest.json" "temp_app\mobile\"
copy /Y "mobile\sw.js"      "temp_app\mobile\"
copy /Y "mobile\icon-192.png" "temp_app\mobile\"
copy /Y "mobile\icon-512.png" "temp_app\mobile\"
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
  echo   "version": "48.1.0",
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
) > "temp_app\package.json"

echo Paso 3.5: Instalando dependencias en la app empaquetada...
cd temp_app
call npm install --production
cd ..

echo Paso 4: Empaquetando en ASAR...
"C:\Program Files\nodejs\node.exe" ".\node_modules\asar\bin\asar.js" pack "temp_app" "%OUT_DIR%\resources\app.asar" --unpack "*.exe"

echo Paso 5: Limpiando...
rmdir /s /q "temp_app"
if exist "%OUT_DIR%\resources\app" rmdir /s /q "%OUT_DIR%\resources\app"

echo Paso 6: Renombrando ejecutable...
rename "%OUT_DIR%\electron.exe" "CajaFreshPOS.exe"

echo.
echo ==============================================
echo  EXITO! La aplicacion v48.1 fue compilada en:
echo  %OUT_DIR%\CajaFreshPOS.exe
echo ==============================================
echo.
echo Abriendo la carpeta de la aplicacion...
start "" "%OUT_DIR%"
