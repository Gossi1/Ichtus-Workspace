@echo off
cd /d "%~dp0"
echo.
echo   ==================================================
echo          ICHTUS WORKSPACE - DEV SERVER
echo   ==================================================
echo.
.venv\Scripts\python.exe server.py --open --port 8080 --host 0.0.0.0
pause
