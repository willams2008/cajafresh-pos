@echo off
title Compilando Punto Pila POS v1.1.0 - FIX TÚNEL & APK

echo ==============================================
echo  Punto Pila POS - Generacion de Distribucion
echo  (Limpieza y Reconstruccion Total)
echo ==============================================
echo.

set DESKTOP_DIR=c:\Users\lenovo\OneDrive\Escritorio
set OUT_DIR=%DESKTOP_DIR%\Punto_Pila_POS_v1.1

echo Paso 1: Limpiando compilaciones fallidas...
if exist "%OUT_DIR%" rmdir /s /q "%OUT_DIR%"
mkdir "%OUT_DIR%"
mkdir "%OUT_DIR%\resources\app"

echo Paso 2: Copiando motor Electron...
xcopy /E /I /Q /Y "node_modules\electron\dist\*" "%OUT_DIR%\"

echo Paso 3: Copiando archivos fuente a resources\app...
copy /Y "index.html" "%OUT_DIR%\resources\app\"
copy /Y "app.js"     "%OUT_DIR%\resources\app\"
copy /Y "main.js"    "%OUT_DIR%\resources\app\"
copy /Y "database.js" "%OUT_DIR%\resources\app\"
copy /Y "cloud-sync.js" "%OUT_DIR%\resources\app\"
copy /Y "license.js" "%OUT_DIR%\resources\app\"
copy /Y "theme.js"   "%OUT_DIR%\resources\app\"
copy /Y "preload.js" "%OUT_DIR%\resources\app\"
copy /Y "style.css"  "%OUT_DIR%\resources\app\"
copy /Y "activation.html" "%OUT_DIR%\resources\app\"
copy /Y "download.html"   "%OUT_DIR%\resources\app\"
copy /Y "propuesta_comercial.html" "%OUT_DIR%\resources\app\"
copy /Y "icon.ico"   "%OUT_DIR%\resources\app\"
copy /Y "icon.png"   "%OUT_DIR%\resources\app\"
copy /Y "pos-pantalla.png"   "%OUT_DIR%\resources\app\"
copy /Y "movil-pantalla.png" "%OUT_DIR%\resources\app\"
copy /Y "pos-demo.mp4"       "%OUT_DIR%\resources\app\"
copy /Y "movil-demo.mp4"     "%OUT_DIR%\resources\app\"
copy /Y "domain-detector.js" "%OUT_DIR%\resources\app\"
copy /Y "lanzar_tunel.bat" "%OUT_DIR%\resources\app\"

echo Paso 4: Copiando aplicaciones adicionales y landing page...
mkdir "%OUT_DIR%\resources\app\mobile"
xcopy /E /I /Q /Y "mobile\*" "%OUT_DIR%\resources\app\mobile\"
mkdir "%OUT_DIR%\resources\app\boss"
xcopy /E /I /Q /Y "boss\*" "%OUT_DIR%\resources\app\boss\"
mkdir "%OUT_DIR%\resources\app\boss-multi"
xcopy /E /I /Q /Y "boss-multi\*" "%OUT_DIR%\resources\app\boss-multi\"
mkdir "%OUT_DIR%\resources\app\landing"
xcopy /E /I /Q /Y "landing\*" "%OUT_DIR%\resources\app\landing\"

echo Paso 5: Copiando modulos (node_modules) - ESTO TARDARA POR EL PESO (741MB)...
echo Por favor espera, estamos asegurando que todo funcione...
:: Usamos robocopy por ser mas rapido y confiable para miles de archivos
robocopy "node_modules" "%OUT_DIR%\resources\app\node_modules" /E /MT:8 /XD ".bin" /NFL /NDL /NJH /NJS /nc /ns /np /R:2 /W:1

echo Paso 6: Configurando package.json interno y ejecutable...
:: Generar package.json minimo necesario para arrancar
(
  echo {
  echo   "name": "puntopila-pos",
  echo   "version": "1.1.0",
  echo   "main": "main.js"
  echo }
) > "%OUT_DIR%\resources\app\package.json"

if exist "%OUT_DIR%\electron.exe" (
    rename "%OUT_DIR%\electron.exe" "PuntoPilaPOS.exe"
)

:: Copiar icono a la carpeta raiz
copy /Y "icon.ico" "%OUT_DIR%\app_icon.ico"

echo.
echo ==============================================
echo  ¡COMPILACION COMPLETADA CORRECTAMENTE!
echo  Ubicacion: %OUT_DIR%
echo  Verifica que PuntoPilaPOS.exe ahora abra bien.
echo ==============================================
echo.
pause
start "" "%OUT_DIR%"
