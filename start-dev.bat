@echo off
setlocal EnableDelayedExpansion

cd /d "%~dp0"

echo.
echo   ==================================================
echo        ICHTUS WORKSPACE - TAURI DEV MODE
echo   ==================================================
echo.
echo   - Wijzigingen in Ichtus_SPA/ en assets/ herladen
echo     automatisch in het Tauri venster (CSS hot-reload)
echo   - Sneltoetsen in venster: F5 of Ctrl+R
echo   - Service Worker cache is uitgeschakeld in dev
echo.

if not exist "node_modules\@tauri-apps\cli" (
    echo   [SETUP] Tauri CLI installeren via npm install...
    call npm install
)

call npm run dev
pause
endlocal
