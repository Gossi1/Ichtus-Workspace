@echo off
setlocal EnableDelayedExpansion

:: ------------------------------------------
::  Self-elevation: herstart als Administrator als nodig
:: ------------------------------------------
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo   Administrator-rechten nodig. Opnieuw starten met UAC...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

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
    echo   [INFO] nssm remove faalde, probeer sc delete...
    sc stop !SVC_NAME! >nul 2>&1
    sc delete !SVC_NAME! >nul 2>&1
    if !errorlevel! neq 0 (
        echo   [ERROR] sc delete faalde ook ^(exit !errorlevel!^).
        echo   Verwijder de service handmatig via services.msc.
        pause
        exit /b 1
    )
    echo   [OK] Service verwijderd via sc delete.
)

:: Controleer of de service echt weg is
sc query !SVC_NAME! >nul 2>&1
if !errorlevel! equ 0 (
    echo   [WARN] Service !SVC_NAME! lijkt er nog steeds te staan.
    echo   Verwijder handmatig via services.msc ^(sc delete !SVC_NAME!^).
    pause
    exit /b 1
)

:: ------------------------------------------------
::  Ruim eventuele overgebleven node.exe-processen op
::  die vanuit deze map zijn gestart, anders houdt Windows
::  de map lock-locked en lukt Remove-Item niet.
:: ------------------------------------------------
echo   Ruim overgebleven node.exe processen op...
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*Ichtus_apps*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
echo   [OK] Processen opgeruimd

echo.
echo   ==================================================
echo   [OK] Service !SVC_NAME! verwijderd.
echo   ==================================================
echo.
pause
endlocal
