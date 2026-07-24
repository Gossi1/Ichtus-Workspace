@echo off
setlocal enabledelayedexpansion

cd /d "%~dp0"

:: ======================================================
::    ICHTUS WORKSPACE - WINDOWS SERVICE INSTALLATIE
:: ======================================================

echo.
echo  ======================================================
echo    ICHTUS WORKSPACE - WINDOWS SERVICE INSTALLATIE
echo  ======================================================
echo.

:: ──────────────────────────────────────────────────
::  0. Admin check
:: ──────────────────────────────────────────────────
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo  [FOUT] Dit script moet als Administrator worden uitgevoerd!
    echo.
    echo         Rechterklik op install-service.bat ^> "Als administrator uitvoeren"
    echo.
    pause
    exit /b 1
)
echo  [OK]   Administrator rechten bevestigd
echo.

:: ──────────────────────────────────────────────────
::  1. NSSM - controleren / downloaden met timeout
:: ──────────────────────────────────────────────────

:: Stale bestanden opruimen van vorige runs
if exist nssm.zip del /q nssm.zip >nul 2>&1
if exist nssm_temp rmdir /s /q nssm_temp >nul 2>&1

:: NSSM detectie via PATH (omzeilt SysWOW64 redirectie)
:: Gebruik GOTO i.p.v. ELSE (voorkomt dat beide branches per ongeluk lopen)
where nssm.exe >nul 2>&1
if !errorlevel! equ 0 goto :nssm_installed

echo  [NSSM] Downloaden van nssm.cc... (max 30 sec)
echo.

:: PowerShell script naar temp bestand (geen complexe inline escaping)
set PS_DL_SCRIPT=%temp%\ichtus_dl_nssm.ps1
echo [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 > "!PS_DL_SCRIPT!"
echo (New-Object System.Net.WebClient).DownloadFile('https://nssm.cc/release/nssm-2.24.zip', '%~dp0nssm.zip') >> "!PS_DL_SCRIPT!"

:: Download starten in achtergrond
start /b "" powershell -ExecutionPolicy Bypass -File "!PS_DL_SCRIPT!" >nul 2>&1

:: Wacht max 30 sec (poll elke ~1s)
set WAIT_COUNT=0
:wait_nssm
if exist nssm.zip goto :nssm_downloaded
ping -n 2 127.0.0.1 >nul
set /a WAIT_COUNT+=1
if !WAIT_COUNT! lss 30 goto :wait_nssm

:: Timeout
echo  [NSSM] Download duurt te lang of is geblokkeerd.
echo         Download zelf:  https://nssm.cc/release/nssm-2.24.zip
echo         Plaats nssm.zip in deze map en draai opnieuw.
echo.
if exist "!PS_DL_SCRIPT!" del /q "!PS_DL_SCRIPT!" >nul 2>&1
pause
exit /b 1

:nssm_downloaded
echo  [NSSM] Gedownload.
if exist "!PS_DL_SCRIPT!" del /q "!PS_DL_SCRIPT!" >nul 2>&1

:: Controleer of zip geldig is (min 10KB)
powershell -Command "& { try { $f = Get-Item 'nssm.zip'; if ($f.Length -lt 10000) { exit 1 } } catch { exit 1 }; exit 0 }" <nul
if !errorlevel! neq 0 (
    echo  [NSSM] Bestand te klein of corrupt - download handmatig van nssm.cc.
    del /q nssm.zip 2>nul
    pause
    exit /b 1
)

echo  [NSSM] Uitpakken...
powershell -Command "& { Expand-Archive -Path nssm.zip -DestinationPath nssm_temp -Force; exit 0 }" <nul

if not exist "nssm_temp\nssm-2.24\win64\nssm.exe" (
    echo  [NSSM] Uitpakken mislukt - nssm.exe niet gevonden in zip.
    pause
    exit /b 1
)

:: Kopieer naar System32 (en Sysnative voor 32-bit cmd op 64-bit Windows)
copy /y "nssm_temp\nssm-2.24\win64\nssm.exe" "%WINDIR%\System32\nssm.exe" >nul 2>&1
set COPY_OK=!errorlevel!
if exist "%WINDIR%\Sysnative" (
    copy /y "nssm_temp\nssm-2.24\win64\nssm.exe" "%WINDIR%\Sysnative\nssm.exe" >nul 2>&1
    if !errorlevel! equ 0 set COPY_OK=0
)
if !COPY_OK! neq 0 (
    echo  [NSSM] Kan nssm.exe niet kopieren naar System32.
    pause
    exit /b 1
)
echo  [NSSM] Gekopieerd naar System32.
goto :nssm_done

:nssm_installed
echo  [NSSM] Al geinstalleerd.

:nssm_done
echo.

:: ──────────────────────────────────────────────────
::  2. Logs directory
:: ──────────────────────────────────────────────────
if not exist logs mkdir logs
echo  [LOGS] logs/ directory OK
echo.

:: ──────────────────────────────────────────────────
::  3. Python vinden (.venv eerst, dan systeem, NOOIT WindowsApps)
:: ──────────────────────────────────────────────────
set PYTHON_PATH=
set PYTHON_IS_VENV=0
set FOUND_PYTHON=

:: 3a. .venv eerst — fast-path (sla systeemzoektocht over als .venv al werkt)
if exist ".venv\Scripts\python.exe" (
    ".venv\Scripts\python.exe" --version >nul 2>&1
    if !errorlevel! equ 0 (
        set PYTHON_PATH=%~dp0.venv\Scripts\python.exe
        set PYTHON_IS_VENV=1
        echo  [PY]   .venv werkt — gebruik: .venv\Scripts\python.exe
        goto :python_show_version
    )
)

:: 3b. Bekende installatiepaden controleren (dit zijn ALTIJD echte Python-installaties)
echo  [PY]   Zoeken naar geïnstalleerde Python 3.8+...

for %%p in (
    "%LOCALAPPDATA%\Programs\Python\Python313\python.exe"
    "%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
    "%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
    "%LOCALAPPDATA%\Programs\Python\Python310\python.exe"
    "C:\Program Files\Python313\python.exe"
    "C:\Program Files\Python312\python.exe"
    "C:\Program Files\Python311\python.exe"
    "C:\Python313\python.exe"
    "C:\Python312\python.exe"
    "C:\Python311\python.exe"
) do (
    if not defined FOUND_PYTHON (
        if exist %%p (
            %%~p --version 2>&1 | findstr /B "Python 3\." >nul
            if !errorlevel! equ 0 (
                set PYTHON_PATH=%%~p
                set FOUND_PYTHON=1
                echo  [PY]   Gevonden via bekend pad: %%~p
            )
        )
    )
)

:: 3c. Via PATH zoeken (MAAR Microsoft Store Python overslaan!)
if not defined FOUND_PYTHON (
    echo  [PY]   Zoeken via PATH (WindowsApps Python overgeslagen)...
    for /f "tokens=*" %%i in ('where python 2^>nul') do (
        if not defined FOUND_PYTHON (
            echo %%i | findstr /I "WindowsApps" >nul 2>&1
            if !errorlevel! neq 0 (
                "%%i" --version 2>&1 | findstr /B "Python 3\." >nul
                if !errorlevel! equ 0 (
                    set PYTHON_PATH=%%i
                    set FOUND_PYTHON=1
                    echo  [PY]   Gevonden via PATH: %%i
                )
            ) else (
                echo  [PY]   Overgeslagen (WindowsApps): %%i
            )
        )
    )
)

:: 3d. Probeer 'python3'
if not defined FOUND_PYTHON (
    for /f "tokens=*" %%i in ('where python3 2^>nul') do (
        if not defined FOUND_PYTHON (
            echo %%i | findstr /I "WindowsApps" >nul 2>&1
            if !errorlevel! neq 0 (
                "%%i" --version 2>&1 | findstr /B "Python 3\." >nul
                if !errorlevel! equ 0 (
                    set PYTHON_PATH=%%i
                    set FOUND_PYTHON=1
                    echo  [PY]   Gevonden via PATH: %%i
                )
            )
        )
    )
)

:: 3e. Python gevonden?
if not defined PYTHON_PATH (
    echo  [PY]   Python 3.8 of hoger niet gevonden!
    echo.
    echo         Let op: De Microsoft Store Python werkt NIET voor Windows-services.
    echo         Installeer Python van https://www.python.org/downloads/
    echo         Zet "Add Python to PATH" AAN bij installatie.
    echo.
    pause
    exit /b 1
)

:: 3f. .venv virtual environment aanmaken/gebruiken (zodat de service altijd via .venv draait)
if not exist ".venv\Scripts\python.exe" (
    echo  [PY]   .venv bestaat nog niet — aanmaken met "!PYTHON_PATH!" -m venv .venv...
    "!PYTHON_PATH!" -m venv .venv
    if !errorlevel! equ 0 (
        echo  [PY]   .venv aangemaakt
        echo  [PY]   Pip-packages installeren...
        ".venv\Scripts\pip.exe" install --upgrade pip >nul 2>&1
        ".venv\Scripts\pip.exe" install -r requirements.txt >nul 2>&1
        set PYTHON_PATH=%~dp0.venv\Scripts\python.exe
        set PYTHON_IS_VENV=1
        echo  [PY]   Gebruik .venv\Scripts\python.exe voor de service
    ) else (
        echo  [PY]   Kon .venv niet aanmaken — gebruik systeem Python direct
    )
) else (
    :: .venv bestaat al — test of het werkt
    echo  [PY]   .venv bestaat al — testen...
    ".venv\Scripts\python.exe" --version >nul 2>&1
    if !errorlevel! equ 0 (
        set PYTHON_PATH=%~dp0.venv\Scripts\python.exe
        set PYTHON_IS_VENV=1
        echo  [PY]   Gebruik .venv\Scripts\python.exe voor de service
    ) else (
        echo  [PY]   .venv verwijst naar niet-bestaande Python — opnieuw aanmaken...
        rmdir /s /q .venv 2>nul
        "!PYTHON_PATH!" -m venv .venv
        if !errorlevel! equ 0 (
            echo  [PY]   .venv opnieuw aangemaakt
            ".venv\Scripts\pip.exe" install -r requirements.txt >nul 2>&1
            set PYTHON_PATH=%~dp0.venv\Scripts\python.exe
            set PYTHON_IS_VENV=1
        ) else (
            echo  [PY]   Kon .venv niet herstellen — gebruik systeem Python
        )
    )
)

:python_show_version
for /f "tokens=*" %%v in ('"!PYTHON_PATH!" --version 2^>^&1') do set PYTHON_VER=%%v
echo  [PY]   Python: !PYTHON_PATH!  (!PYTHON_VER!)
echo.

:: ──────────────────────────────────────────────────
::  4. Poort 8080 vrijmaken
:: ──────────────────────────────────────────────────
echo  [PORT] Controleren of poort 8080 vrij is...
set PORT_FREED=0
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8080" ^| findstr "LISTENING"') do (
    echo  [PORT] Proces PID %%a stoppen op poort 8080...
    taskkill /F /PID %%a >nul 2>&1
    set PORT_FREED=1
)
if !PORT_FREED! equ 1 (
    timeout /t 2 /nobreak >nul
)
echo  [PORT] Poort 8080 vrij
echo.

:: ──────────────────────────────────────────────────
::  5. Bestaande service verwijderen
:: ──────────────────────────────────────────────────
echo  [SERVICE] Eventuele bestaande service stoppen/verwijderen...
nssm stop IchtusServer >nul 2>&1
nssm remove IchtusServer confirm >nul 2>&1
timeout /t 1 /nobreak >nul
echo  [SERVICE] Klaar
echo.

:: ──────────────────────────────────────────────────
::  6. Service installeren
:: ──────────────────────────────────────────────────
echo  [SERVICE] IchtusServer installeren...

nssm install IchtusServer "!PYTHON_PATH!" >nul 2>&1
if !errorlevel! neq 0 (
    echo  [SERVICE] Kon service niet aanmaken!
    echo            Probeer: nssm remove IchtusServer confirm
    echo.
    pause
    exit /b 1
)

nssm set IchtusServer Application "!PYTHON_PATH!" >nul
nssm set IchtusServer AppParameters "server.py --port 8080 --host 0.0.0.0 --no-update-check" >nul
nssm set IchtusServer AppDirectory "%~dp0." >nul
nssm set IchtusServer AppStdout "%~dp0logs\service-output.log" >nul
nssm set IchtusServer AppStderr "%~dp0logs\service-error.log" >nul
nssm set IchtusServer AppRotateFiles 1 >nul
nssm set IchtusServer AppRotateOnline 1 >nul
nssm set IchtusServer AppRotateBytes 5000000 >nul
nssm set IchtusServer AppNoConsole 1 >nul
nssm set IchtusServer Start SERVICE_AUTO_START >nul
nssm set IchtusServer DisplayName "Ichtus Workspace Server" >nul
nssm set IchtusServer Description "Ichtus Workspace - Kerkdienstbeheer SPA/PWA" >nul
nssm set IchtusServer ObjectName LocalSystem >nul
nssm set IchtusServer AppThrottle 3000 >nul
nssm set IchtusServer AppExit Default Exit >nul

echo  [SERVICE] Configuratie voltooid
echo.

:: ──────────────────────────────────────────────────
::  7. Service starten (met retry)
:: ──────────────────────────────────────────────────
echo  [SERVICE] IchtusServer starten...
echo           (max 5 pogingen met 2s tussentijd)
echo.

nssm start IchtusServer >nul 2>&1

set RETRIES=0
:start_retry
set /a RETRIES+=1

timeout /t 2 /nobreak >nul

nssm status IchtusServer | findstr "RUNNING" >nul 2>&1
if !errorlevel! equ 0 (
    echo  [SERVICE] Gestart en draait!  (poging !RETRIES! van 5)
    goto :service_ok
)

nssm status IchtusServer | findstr "STOPPED" >nul 2>&1
if !errorlevel! equ 0 (
    echo  [SERVICE] Service is gestopt (gestart maar gecrasht).
    echo            Check logs:   type logs\service-error.log
    goto :service_fail
)

if !RETRIES! lss 5 (
    echo  [SERVICE] Nog bezig... (poging !RETRIES! van 5)
    goto :start_retry
)

:service_fail
echo.
echo  [SERVICE] Service startte niet binnen 10 seconden.
echo.
echo         Wat nu?
echo          1. Check logs:     type logs\service-error.log
echo          2. Check poort:    netstat -ano | findstr :8080
echo          3. Handmatig:      nssm start IchtusServer
echo          4. Configuratie:   nssm edit IchtusServer
echo.
goto :cleanup

:service_ok
echo.

:: ──────────────────────────────────────────────────
::  8. Opruimen
:: ──────────────────────────────────────────────────
:cleanup
echo  [CLEANUP] Opruimen tijdelijke bestanden...
if exist nssm.zip del /q nssm.zip >nul 2>&1
if exist nssm_temp rmdir /s /q nssm_temp >nul 2>&1
if exist "%temp%\ichtus_dl_nssm.ps1" del /q "%temp%\ichtus_dl_nssm.ps1" >nul 2>&1
echo  [CLEANUP] Klaar
echo.

:: ──────────────────────────────────────────────────
::  9. Resultaat
:: ──────────────────────────────────────────────────
echo  ======================================================
echo    GEREED
echo  ======================================================
echo.
echo    Service:   IchtusServer
echo    Status:    Automatisch starten met Windows
echo    Python:    !PYTHON_PATH!
echo    Poort:     http://localhost:8080/
echo    PWA:       http://localhost:8080/Ichtus_SPA/
echo.
echo    Beheer commando's:
echo      nssm  start     IchtusServer
echo      nssm  stop      IchtusServer
echo      nssm  restart   IchtusServer
echo      nssm  status    IchtusServer
echo      nssm  edit      IchtusServer     (configuratie wijzigen)
echo.
echo    Logs:
echo      type logs\service-output.log
echo      type logs\service-error.log
echo.
echo  ======================================================
echo.

pause
endlocal
