@echo off
setlocal EnableDelayedExpansion

cd /d "%~dp0"

echo.
echo   ==================================================
echo      ICHTUS SERVER - NSSM SERVICE UNINSTALLER
echo   ==================================================
echo.

:: ------------------------------------------
::  Service naam: default 'IchtusServer' en probeer
::  die uit nssm-service.json te lezen als die er is.
:: ------------------------------------------
set "SVC_NAME=IchtusServer"
if exist "nssm-service.json" (
    for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "$j = Get-Content -Raw nssm-service.json ^| ConvertFrom-Json; if ($j.serviceName) { $j.serviceName } else { '' }"`) do (
        if not "%%i"=="" set "SVC_NAME=%%i"
    )
)
echo   [SVC] !SVC_NAME!  ^(uit nssm-service.json of default^)

:: ------------------------------------------
::  NSSM-pad zoeken in deze volgorde:
::    1. nssm-service.json -^> nssmPath
::    2. nssm_temp\nssm-2.24\<arch>\nssm.exe  (onze portable install)
::    3. nssm.exe ergens op PATH
:: ------------------------------------------
set "NSSM_PATH="
if exist "nssm-service.json" (
    for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "$j = Get-Content -Raw nssm-service.json ^| ConvertFrom-Json; if ($j.nssmPath) { $j.nssmPath } else { '' }"`) do (
        if not "%%i"=="" set "NSSM_PATH=%%i"
    )
)
if "!NSSM_PATH!"=="" (
    if exist "nssm_temp\nssm-2.24\win64\nssm.exe" (
        set "NSSM_PATH=nssm_temp\nssm-2.24\win64\nssm.exe"
    ) else if exist "nssm_temp\nssm-2.24\win32\nssm.exe" (
        set "NSSM_PATH=nssm_temp\nssm-2.24\win32\nssm.exe"
    )
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
    echo   Installeer NSSM of zet het pad in nssm-service.json.
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
    echo   [INFO] Service !SVC_NAME! is niet geregistreerd.
    pause
    exit /b 0
)

echo   Weet je zeker dat je service !SVC_NAME! wilt verwijderen? (J/N)
set /p CONFIRM="   > "
if /i not "!CONFIRM!"=="J" (
    echo   [INFO] Afgebroken.
    pause
    exit /b 0
)

:: ------------------------------------------
::  Stoppen + verwijderen. Directe exec (geen `call`
::  keyword) vermijdt cmd's edge-case met gecombineerde
::  quoted/unquoted argumenten.
:: ------------------------------------------
echo.
echo   Service stoppen...
"!NSSM_PATH!" stop !SVC_NAME!
timeout /t 3 /nobreak >nul

echo   Service verwijderen...
"!NSSM_PATH!" remove !SVC_NAME! confirm
if !errorlevel! neq 0 (
    echo   [ERROR] Verwijderen mislukt (exit !errorlevel!).
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
