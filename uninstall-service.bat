@echo off
setlocal EnableDelayedExpansion

cd /d "%~dp0"

:: ------------------------------------------
::  Administrator-rechten controleren
:: ------------------------------------------
fltmc >nul 2>&1
if !errorlevel! neq 0 (
    echo.
    echo   ==================================================
    echo   [WAARSCHUWING] Administrator-rechten vereist!
    echo   ==================================================
    echo.
    echo   Klik met de rechtermuisknop op dit bestand en kies:
    echo   "Als administrator uitvoeren" (Run as administrator)
    echo.
    pause
    exit /b 1
)

echo.
echo   ==================================================
echo     ICHTUS SERVER - WINSW SERVICE UNINSTALLER
echo   ==================================================
echo.

set "SVC_NAME=IchtusServer"
set "WINSW_EXE=%CD%\bin\winsw\%SVC_NAME%.exe"
echo   [SVC]  !SVC_NAME!

:: ------------------------------------------
::  Service bestaat?
:: ------------------------------------------
sc query !SVC_NAME! >nul 2>&1
if !errorlevel! neq 0 (
    echo   [INFO] Service !SVC_NAME! is niet geregistreerd. Niets te doen.
    pause
    exit /b 0
)

:: ------------------------------------------
::  Bevestiging + uitvoeren
:: ------------------------------------------
set /p CONFIRM="   Service !SVC_NAME! verwijderen? (J/N) > "
if /i not "!CONFIRM!"=="J" (
    echo   [INFO] Afgebroken.
    pause
    exit /b 0
)

echo.
echo   Service stoppen...
sc stop !SVC_NAME! >nul 2>&1
if exist "!WINSW_EXE!" "!WINSW_EXE!" stop >nul 2>&1
ping 127.0.0.1 -n 3 >nul

echo   Service de-installeren...
if exist "!WINSW_EXE!" "!WINSW_EXE!" uninstall >nul 2>&1
sc delete !SVC_NAME! >nul 2>&1
ping 127.0.0.1 -n 3 >nul

:: Controleer of de service echt weg is
sc query !SVC_NAME! >nul 2>&1
if !errorlevel! equ 0 (
    echo   [WARN] Service !SVC_NAME! lijkt nog geregistreerd te zijn.
    echo   Verwijder eventueel handmatig via services.msc (sc delete !SVC_NAME!).
    pause
    exit /b 1
)

:: ------------------------------------------------
::  Ruim eventuele overgebleven node.exe-processen op
:: ------------------------------------------------
echo   Ruim overgebleven node.exe processen op...
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*Ichtus_apps*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
echo   [OK] Processen opgeruimd

echo.
echo   ==================================================
echo   [OK] Service !SVC_NAME! succesvol verwijderd.
echo   ==================================================
echo.
pause
endlocal
exit /b 0
