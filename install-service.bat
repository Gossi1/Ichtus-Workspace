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

if exist nssm.zip del /q nssm.zip >nul 2>&1
if exist nssm_temp rmdir /s /q nssm_temp >nul 2>&1

where nssm.exe >nul 2>&1
if !errorlevel! equ 0 goto :nssm_installed

echo  [NSSM] Downloaden van nssm.cc... (max 30 sec)
echo.

set "PS_DL_SCRIPT=%temp%\ichtus_dl_nssm.ps1"
echo [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 > "!PS_DL_SCRIPT!"
echo (New-Object System.Net.WebClient).DownloadFile('https://nssm.cc/release/nssm-2.24.zip', '%~dp0nssm.zip') >> "!PS_DL_SCRIPT!"

start /b "" powershell -ExecutionPolicy Bypass -File "!PS_DL_SCRIPT!" >nul 2>&1

set WAIT_COUNT=0
:wait_nssm
if exist nssm.zip goto :nssm_downloaded
ping -n 2 127.0.0.1 >nul
set /a WAIT_COUNT+=1
if !WAIT_COUNT! lss 30 goto :wait_nssm

echo  [NSSM] Download duurt te lang of is geblokkeerd.
if exist "!PS_DL_SCRIPT!" del /q "!PS_DL_SCRIPT!" >nul 2>&1
pause
exit /b 1

:nssm_downloaded
echo  [NSSM] Gedownload.
if exist "!PS_DL_SCRIPT!" del /q "!PS_DL_SCRIPT!" >nul 2>&1

powershell -Command "& { try { $f = Get-Item 'nssm.zip'; if ($f.Length -lt 10000) { exit 1 } } catch { exit 1 }; exit 0 }" <nul
if !errorlevel! neq 0 (
    echo  [NSSM] Bestand te klein of corrupt.
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
::  3. Python vinden
:: ──────────────────────────────────────────────────
set "PYTHON_PATH="
set "PYTHON_IS_VENV=0"
set "FOUND_PYTHON="

:: 3a. .venv controleren (moet wel werken EN mag GEEN WindowsApps zijn)
if exist ".venv\Scripts\python.exe" (
    ".venv\Scripts\python.exe" -c "import sys; print(sys.executable)" 2>nul | findstr /I "WindowsApps" >nul
    if !errorlevel! equ 0 (
        echo  [PY]   Oude .venv gebruikt WindowsApps Python — verwijderen...
        rmdir /s /q .venv >nul 2>&1
    ) else (
        ".venv\Scripts\python.exe" --version >nul 2>&1
        if !errorlevel! equ 0 (
            set "PYTHON_PATH=%~dp0.venv\Scripts\python.exe"
            set "PYTHON_IS_VENV=1"
            echo  [PY]   .venv werkt — gebruik: .venv\Scripts\python.exe
            goto :python_show_version
        )
    )
)

:: 3b. Bekende installatiepaden controleren
echo  [PY]   Zoeken naar geinstalleerde Python 3.8+...

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
    if not defined FOUND_PYTHON if exist "%%~p" (
        "%%~p" --version 2>&1 | findstr /B "Python 3." >nul
        if !errorlevel! equ 0 (
            set "PYTHON_PATH=%%~p"
            set "FOUND_PYTHON=1"
            echo  [PY]   Gevonden via bekend pad: %%~p
        )
    )
)

:: 3c. Via PATH zoeken (WindowsApps overslaan)
if not defined FOUND_PYTHON (
    echo  [PY]   Zoeken via PATH...
    for /f "tokens=*" %%i in ('where python 2^>nul') do (
        if not defined FOUND_PYTHON (
            echo %%i | findstr /I "WindowsApps" >nul 2>&1
            if !errorlevel! neq 0 (
                "%%i" --version 2>&1 | findstr /B "Python 3." >nul
                if !errorlevel! equ 0 (
                    set "PYTHON_PATH=%%i"
                    set "FOUND_PYTHON=1"
                    echo  [PY]   Gevonden via PATH: %%i
                )
            )
        )
    )
)

:: 3d. Probeer python3
if not defined FOUND_PYTHON (
    for /f "tokens=*" %%i in ('where python3 2^>nul') do (
        if not defined FOUND_PYTHON (
            echo %%i | findstr /I "WindowsApps" >nul 2>&1
            if !errorlevel! neq 0 (
                "%%i" --version 2>&1 | findstr /B "Python 3." >nul
                if !errorlevel! equ 0 (
                    set "PYTHON_PATH=%%i"
                    set "FOUND_PYTHON=1"
                    echo  [PY]   Gevonden via PATH: %%i
                )
            )
        )
    )
)

:: 3e. Python niet gevonden? Automatisch downloaden & installeren!
if not defined FOUND_PYTHON (
    echo  [PY]   Geen geschikte Python installatie gevonden.
    echo  [PY]   Python 3.12 downloaden en stil installeren...
    echo.
    
    powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; (New-Object System.Net.WebClient).DownloadFile('https://www.python.org/ftp/python/3.12.8/python-3.12.8-amd64.exe', '%temp%\python_installer.exe')" >nul 2>&1
    
    if exist "%temp%\python_installer.exe" (
        echo  [PY]   Python installeren voor alle gebruikers...
        "%temp%\python_installer.exe" /quiet InstallAllUsers=1 PrependPath=1 Include_test=0
        del /q "%temp%\python_installer.exe" >nul 2>&1
        
        if exist "C:\Program Files\Python312\python.exe" (
            set "PYTHON_PATH=C:\Program Files\Python312\python.exe"
            set "FOUND_PYTHON=1"
            echo  [PY]   Python 3.12 succesvol geinstalleerd!
        ) else if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" (
            set "PYTHON_PATH=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
            set "FOUND_PYTHON=1"
            echo  [PY]   Python 3.12 succesvol geinstalleerd!
        )
    )
    
    if not defined PYTHON_PATH (
        echo  [PY]   Automatische installatie mislukt.
        pause
        exit /b 1
    )
)

:: 3f. Virtual environment (.venv) aanmaken
if not exist ".venv\Scripts\python.exe" (
    echo  [PY]   .venv aanmaken met "!PYTHON_PATH!"...
    "!PYTHON_PATH!" -m venv .venv
    if !errorlevel! equ 0 (
        echo  [PY]   .venv aangemaakt
        echo  [PY]   Pip-packages installeren...
        ".venv\Scripts\pip.exe" install --upgrade pip >nul 2>&1
        ".venv\Scripts\pip.exe" install -r requirements.txt >nul 2>&1
        set "PYTHON_PATH=%~dp0.venv\Scripts\python.exe"
        set "PYTHON_IS_VENV=1"
    )
) else (
    set "PYTHON_PATH=%~dp0.venv\Scripts\python.exe"
)

:python_show_version
for /f "tokens=*" %%v in ('"!PYTHON_PATH!" --version 2^>^&1') do set "PYTHON_VER=%%v"
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
::  7. Service starten
:: ──────────────────────────────────────────────────
echo  [SERVICE] IchtusServer starten...
nssm start IchtusServer >nul 2>&1

set RETRIES=0
:start_retry
set /a RETRIES+=1
timeout /t 2 /nobreak >nul

nssm status IchtusServer | findstr "RUNNING" >nul 2>&1
if !errorlevel! equ 0 (
    echo  [SERVICE] Gestart en draait!
    goto :service_ok
)

if !RETRIES! lss 5 goto :start_retry

echo  [SERVICE] Service startte niet. Check logs\service-error.log

:service_ok
echo.

:: ──────────────────────────────────────────────────
::  8. Opruimen
:: ──────────────────────────────────────────────────
if exist nssm.zip del /q nssm.zip >nul 2>&1
if exist nssm_temp rmdir /s /q nssm_temp >nul 2>&1
if exist "%temp%\ichtus_dl_nssm.ps1" del /q "%temp%\ichtus_dl_nssm.ps1" >nul 2>&1

echo  ======================================================
echo    GEREED
echo  ======================================================
echo    Service: IchtusServer
echo    Poort:   http://localhost:8080/
echo  ======================================================
echo.

pause
endlocal