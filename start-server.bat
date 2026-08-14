@echo off
setlocal EnableDelayedExpansion

cd /d "%~dp0"

echo.
echo   ==================================================
echo          ICHTUS WORKSPACE - NODE.JS SERVER
echo   ==================================================
echo.
echo   Alle services in één proces op poort 8080:
echo     - SPA HTTP server + Firebase config injectie
echo     - X32 OSC bridge (UDP :10023)
echo     - Mic/IEM monitor (Firestore)
echo     - WebSocket realtime hub (/ws)
echo     - Git update checking
echo.
echo   Stoppen: Ctrl+C in dit venster
echo.

:: ──────────────────────────────────────────
::  1. Node.js aanwezig?
:: ──────────────────────────────────────────
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo   [ERROR] Node.js niet gevonden!
    echo.
    echo   Installeer Node.js van https://nodejs.org/
    echo   (LTS versie aanbevolen)
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node --version 2^>nul') do set NODE_VER=%%i
echo   [NODE] !NODE_VER! gevonden

:: ──────────────────────────────────────────
::  2. node_modules controleren / npm install
:: ──────────────────────────────────────────
if not exist "node_modules" (
    echo.
    echo   [SETUP] node_modules ontbreekt - npm install uitvoeren...
    echo.
    call npm install
    if !errorlevel! neq 0 (
        echo.
        echo   [ERROR] npm install mislukt!
        pause
        exit /b 1
    )
    echo.
    echo   [OK] Dependencies geinstalleerd
) else (
    echo   [OK] node_modules aanwezig
)

:: ──────────────────────────────────────────
::  3. Poort 8080 controleren
:: ──────────────────────────────────────────
set PORT_FREE=1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8080" ^| findstr "LISTENING" 2^>nul') do (
    set PORT_FREE=0
    set OLD_PID=%%a
)

if "!PORT_FREE!"=="0" (
    echo.
    echo   [WARN] Poort 8080 is al in gebruik (PID !OLD_PID!)
    echo.
    echo   Mogelijk draait er nog een oude server.
    echo   Wil je het proces stoppen? (J/N)
    set /p KILL_CHOICE="   > "
    if /i "!KILL_CHOICE!"=="J" (
        taskkill /F /PID !OLD_PID! >nul 2>&1
        timeout /t 2 /nobreak >nul
        echo   [OK] Proces !OLD_PID! gestopt
    ) else (
        echo.
        echo   [INFO] Server kan niet starten op :8080
        echo          Stop het bestaande proces handmatig of kies een andere poort.
        pause
        exit /b 1
    )
)

:: ──────────────────────────────────────────
::  4. Server starten
:: ──────────────────────────────────────────
echo.
echo   ==================================================
echo   Server starten op http://localhost:8080
echo   ==================================================
echo.
echo   Open in je browser:
echo     http://localhost:8080/Ichtus_SPA/
echo.
echo   API Endpoints:
echo     /api/health         Health check
echo     /api/status         Status + logs
echo     /api/x32/*          X32 OSC bridge
echo     /api/iem/*          Mic/IEM monitor
echo     /api/check-update   Git update check
echo     /ws                 WebSocket
echo.
echo   Druk Ctrl+C om te stoppen
echo   ==================================================
echo.

node src/server.js

:: Server is gestopt (Ctrl+C of crash)
echo.
echo   ==================================================
echo   Server gestopt
echo   ==================================================
pause
endlocal
