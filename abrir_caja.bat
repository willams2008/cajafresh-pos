@echo off
pushd "%~dp0"
set ELECTRON_RUN_AS_NODE=
echo Lanzando Punto Pila POS...
start "" "node_modules\electron\dist\electron.exe" .
popd
exit
