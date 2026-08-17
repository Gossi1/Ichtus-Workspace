@echo off
setlocal EnableDelayedExpansion

cd /d "%~dp0"

echo.
echo   ==================================================
echo     ICHTUS SERVER - NSSM SERVICE UNINSTALLER
echo   ==================================================
echo.

:: ------------------------------------------
::  Service naam (default IchtusServer; wijzig hier
::  als je de service hernoemd hebt)
:: ------------------------------------------
set "SVC_NAME=IchtusServer"
echo   [SVC]  !SVC_NAME!

:: ------------------------------------------
::  nssm.exe zoeken in deze volgorde:
::    1. nssm_temp\nssm-2.24\win64\nssm.exe (64-bit portable)
::    2. nssm_temp\nssm-2.24\win32\nssm.exe (32-bit portable)
::    3. nssm.exe ergens op PATH
:: ------------------------------------------
set "NSSM_PATH="
if exist "nssm_temp\nssm-2.24\win64\nssm.exe" (
    set "NSSM_PATH=nssm_temp\nssm-2.24\win64\nssm.exe"
)
if "!NSSM_PATH!"=="" if exist "nssm_temp\nssm-2.24\win32\nssm.exe" (
    set "NSSM_PATH=nssm_temp\nssm-2.24\win32\nssm.exe"
)
if "!NSSM_PATH!"=="" (
    where nssm >nul 2>&1
    if !errorlevel!==0 (
        for /f "delims=" %%i in ('where nssm') do (
            set "NSSM_PATH=%%i"
            goto :nssm_found
        )
    )
)

:nssm_found
if "!NSSM_PATH!"=="" (
    echo   [ERROR] nssm.exe niet gevonden.
    echo   Geinstalleerd in nssm_temp\ wordt verwacht, of op PATH.
    pause
    exit /b 1
)
if not exist "!NSSM_PATH!" (
    echo   [ERROR] nssm.exe bestaat niet op "!NSSM_PATH!"
    pause
    exit /b 1
)
echo   [NSSM] !NSSM_PATH!
echo.

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
set /p CONFIRM="   Verwijderen? (J/N) > "
if /i not "!CONFIRM!"=="J" (
    echo   [INFO] Afgebroken.
    pause
    exit /b 0
)

echo.
echo   Service stoppen...
"!NSSM_PATH!" stop !SVC_NAME! >nul 2>&1
timeout /t 3 /nobreak >nul

echo   Service verwijderen...
"!NSSM_PATH!" remove !SVC_NAME! confirm
if !errorlevel! neq 0 (
    echo   [ERROR] Verwijderen faalde ^(exit !errorlevel!^).
    echo   Mogelijk moet je de service handmatig uit services.msc verwijderen.
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
