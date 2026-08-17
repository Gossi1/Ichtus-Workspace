@echo off
setlocal EnableDelayedExpansion

cd /d "%~dp0"

echo.
echo   ==================================================
echo      ICHTUS SERVER - NSSM SERVICE UNINSTALLER
echo   ==================================================
echo.

:: Pad naar nssm bepalen
set "NSSM_PATH="
if exist "nssm-service.json" (
    for /f "delims=" %%i in ('powershell -NoProfile -Command "(Get-Content -Raw nssm-service.json ^| ConvertFrom-Json).nssmPath"') do set NSSM_PATH=%%i
)
if "!NSSM_PATH!"=="" (
    where nssm >nul 2>&1
    if !errorlevel!==0 (
        for /f "delims=" %%i in ('where nssm') do set "NSSM_PATH=%%i"
    )
)

if "!NSSM_PATH!"=="" (
    echo   [ERROR] nssm.exe niet gevonden.
    echo   Installeer NSSM of zet het pad in nssm-service.json.
    pause
    exit /b 1
)

if not exist "nssm-service.json" (
    echo   [WARN] nssm-service.json niet gevonden.
    set /p SVC_NAME="   Voer service naam in (default: IchtusServer): "
    if "!SVC_NAME!"=="" set "SVC_NAME=IchtusServer"
) else (
    for /f "delims=" %%i in ('powershell -NoProfile -Command "(Get-Content -Raw nssm-service.json ^| ConvertFrom-Json).serviceName"') do set SVC_NAME=%%i
)

sc query !SVC_NAME! >nul 2>&1
if !errorlevel! neq 0 (
    echo   [INFO] Service !SVC_NAME! is niet geregistreerd.
    pause
    exit /b 0
)

echo.
echo   Weet je zeker dat je service !SVC_NAME! wilt verwijderen? (J/N)
set /p CONFIRM="   > "
if /i not "!CONFIRM!"=="J" (
    echo   [INFO] Afgebroken.
    pause
    exit /b 0
)

echo.
echo   Service stoppen...
call "!NSSM_PATH!" stop !SVC_NAME! >nul 2>&1
timeout /t 3 /nobreak >nul

echo   Service verwijderen...
call "!NSSM_PATH!" remove !SVC_NAME! confirm
if !errorlevel! neq 0 (
    echo   [ERROR] Verwijderen mislukt.
    pause
    exit /b 1
)

echo.
echo   ==================================================
echo   [OK] Service !SVC_NAME! verwijderd.
echo   ==================================================
echo.
pause
endlocal
