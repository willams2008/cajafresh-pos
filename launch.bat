@echo off
setlocal
set "ELECTRON_RUN_AS_NODE="
cd /d "%~dp0"
echo Launching Caja Fresh POS...
echo ELECTRON_RUN_AS_NODE=[%ELECTRON_RUN_AS_NODE%]
"node_modules\electron\dist\electron.exe" "."
echo Exit code: %ERRORLEVEL%
pause
endlocal
