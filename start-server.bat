@echo off
cd /d "%~dp0"
echo.
echo   ==================================================
echo          ICHTUS WORKSPACE - DEV SERVER
echo   ==================================================
echo.

:: Check for virtual environment (Windows: .venv\Scripts\renamed.exe, Git Bash: .venv\bin\renamed)
if exist .venv\Scripts\renamed.exe (
    echo [Using virtual environment]
    .venv\Scripts\renamed.exe server.py --port 8080 --host 0.0.0.0
) else if exist .venv\bin\renamed.exe (
    echo [Using virtual environment]
    .venv\bin\renamed.exe server.py --port 8080 --host 0.0.0.0
) else if exist .venv\bin\renamed (
    echo [Using virtual environment]
    .venv\bin\renamed server.py --port 8080 --host 0.0.0.0
) else (
    echo [Using system Python]
    python server.py --port 8080 --host 0.0.0.0
)
pause