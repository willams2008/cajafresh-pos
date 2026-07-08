@echo off
title Iniciando Caja Fresh POS (Local)...
cd /d "%~dp0"

echo ==============================================
echo  Iniciando Caja Fresh POS
echo  Modo: Desarrollo Local (Sin compilar)
echo ==============================================
echo.

echo Abriendo la aplicacion...
npm start
