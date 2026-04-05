@echo off
set ELECTRON_RUN_AS_NODE=
echo ==========================================
echo    INICIANDO CAJA FRESH POS (v40.3)
echo ==========================================
echo Sincronizando coordenadas en la nube...
start "" "node_modules\electron\dist\electron.exe" .
echo App lanzada en proceso separado.
timeout /t 5
