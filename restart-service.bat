@echo off
setlocal EnableDelayedExpansion

cd /d "%~dp0"

echo ==================================================
echo      ICHTUS SERVER - SERVICE RESTARTER
echo ==================================================
echo.

:: Check Administrator rechten
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo   [WAARSCHUWING] Dit script vereist Administrator-rechten.
    echo   Klik met de rechtermuisknop op dit bestand en kies:
    echo   "Als administrator uitvoeren" (Run as administrator)
    echo.
    pause
    exit /b 1
)

set "SVC_NAME=IchtusServer"
set "NSSM_PATH="
if exist "%~dp0bin\nssm\win64\nssm.exe" set "NSSM_PATH=%~dp0bin\nssm\win64\nssm.exe"
if "!NSSM_PATH!"=="" if exist "%~dp0bin\nssm\win32\nssm.exe" set "NSSM_PATH=%~dp0bin\nssm\win32\nssm.exe"

echo   [1/2] Service stoppen...
if not "!NSSM_PATH!"=="" (
    "!NSSM_PATH!" stop !SVC_NAME! >nul 2>&1
) else (
    net stop !SVC_NAME! >nul 2>&1
)

timeout /t 2 /nobreak >nul

echo   [2/2] Service starten...
if not "!NSSM_PATH!"=="" (
    "!NSSM_PATH!" start !SVC_NAME! >nul 2>&1
) else (
    net start !SVC_NAME! >nul 2>&1
)

timeout /t 2 /nobreak >nul

sc query !SVC_NAME! | findstr /i "STATE"
echo.
echo   [OK] !SVC_NAME! is herstart!
echo.
pause
