@echo off
cd /d "%~dp0"
echo.
echo   ==================================================
echo          ICHTUS WORKSPACE - DEV SERVER
echo   ==================================================
echo.

:: Check for virtual environment (Windows: .venv\Scripts\python.exe, Git Bash: .venv\bin\python)
if exist .venv\Scripts\python.exe (
    echo [Using virtual environment]
    .venv\Scripts\python.exe server.py --port 8080 --host 0.0.0.0
) else if exist .venv\bin\python.exe (
    echo [Using virtual environment]
    .venv\bin\python.exe server.py --port 8080 --host 0.0.0.0
) else if exist .venv\bin\python (
    echo [Using virtual environment]
    .venv\bin\python server.py --port 8080 --host 0.0.0.0
) else (
    echo [Using system Python]
    python server.py --port 8080 --host 0.0.0.0
)
pause