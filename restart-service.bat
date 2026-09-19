@echo off
setlocal EnableDelayedExpansion

cd /d "%~dp0"

echo ==================================================
echo      ICHTUS SERVER - SERVICE RESTARTER
echo ==================================================
echo.

:: Check Administrator rechten
fltmc >nul 2>&1
if !errorlevel! neq 0 (
    echo   [WAARSCHUWING] Dit script vereist Administrator-rechten.
    echo   Klik met de rechtermuisknop op dit bestand en kies:
    echo   "Als administrator uitvoeren" (Run as administrator)
    echo.
    pause
    exit /b 1
)

set "SVC_NAME=IchtusServer"
set "WINSW_EXE=%CD%\bin\winsw\%SVC_NAME%.exe"

if exist "!WINSW_EXE!" (
    echo   Service herstarten via WinSW...
    "!WINSW_EXE!" restart
) else (
    echo   [INFO] WinSW binary niet gevonden op !WINSW_EXE! - fallback via net stop/start...
    net stop !SVC_NAME! >nul 2>&1
    ping 127.0.0.1 -n 3 >nul
    net start !SVC_NAME! >nul 2>&1
)

ping 127.0.0.1 -n 3 >nul

echo.
sc query !SVC_NAME! | findstr /i "STATE"
echo.
echo   [OK] !SVC_NAME! is herstart!
echo.
pause
endlocal
exit /b 0
