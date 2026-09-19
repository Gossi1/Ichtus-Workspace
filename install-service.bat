@echo off
setlocal EnableDelayedExpansion

cd /d "%~dp0"

set "SVC_NAME=IchtusServer"
set "SVC_DIR=%CD%"
set "WINSW_DIR=%CD%\bin\winsw"
set "WINSW_SOURCE=%WINSW_DIR%\WinSW.NET461.exe"
set "WINSW_EXE=%WINSW_DIR%\%SVC_NAME%.exe"
set "WINSW_XML=%WINSW_DIR%\%SVC_NAME%.xml"
set "ROOT_XML=%CD%\winsw-service.xml"
set "EXAMPLE_XML=%CD%\winsw-service.example.xml"

echo.
echo   ==================================================
echo      ICHTUS SERVER - WINSW SERVICE INSTALLER
echo   ==================================================
echo.

:: 1. Node.js aanwezig?
where node >nul 2>&1
if !errorlevel! equ 0 goto :node_found
echo   [ERROR] Node.js niet gevonden. Installeer Node.js LTS van https://nodejs.org/
pause
exit /b 1

:node_found
for /f "tokens=*" %%i in ('node --version 2^>nul') do set "NODE_VER=%%i"
for /f "delims=" %%i in ('where node 2^>nul') do (
    set "NODE_EXE=%%i"
    goto :node_path_done
)
:node_path_done
echo   [NODE]  !NODE_VER! gevonden [!NODE_EXE!]

:: 2. XML configuratie controleren
if exist "!ROOT_XML!" goto :xml_ok
if exist "!EXAMPLE_XML!" (
    copy /y "!EXAMPLE_XML!" "!ROOT_XML!" >nul
    echo   [OK]   winsw-service.xml aangemaakt
    goto :xml_ok
)
echo   [ERROR] winsw-service.example.xml ontbreekt in %CD%.
pause
exit /b 1

:xml_ok
:: 3. WinSW binary controleren of downloaden
if not exist "!WINSW_DIR!" mkdir "!WINSW_DIR!" >nul 2>&1

if exist "!WINSW_SOURCE!" goto :winsw_bin_ok
echo   [INFO] WinSW.NET461.exe downloaden...
powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; try { Invoke-WebRequest -Uri 'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW.NET461.exe' -OutFile '!WINSW_SOURCE!' -UseBasicParsing -ErrorAction Stop; exit 0 } catch { exit 1 }" >nul 2>&1
if !errorlevel! neq 0 (
    curl.exe -sSL -o "!WINSW_SOURCE!" "https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW.NET461.exe" >nul 2>&1
)
if exist "!WINSW_SOURCE!" goto :winsw_bin_ok
echo   [ERROR] Kon WinSW.NET461.exe niet downloaden.
pause
exit /b 1

:winsw_bin_ok
:: 4. Logs map controleren
if not exist "%CD%\logs" mkdir "%CD%\logs" >nul 2>&1

:: 5. Bestaande service stoppen en verwijderen
sc query !SVC_NAME! >nul 2>&1
if !errorlevel! neq 0 goto :skip_remove

echo.
echo   [INFO] Bestaande service opruimen...
sc stop !SVC_NAME! >nul 2>&1
if exist "!WINSW_EXE!" "!WINSW_EXE!" stop >nul 2>&1
ping 127.0.0.1 -n 3 >nul

if exist "!WINSW_EXE!" "!WINSW_EXE!" uninstall >nul 2>&1
sc delete !SVC_NAME! >nul 2>&1
ping 127.0.0.1 -n 3 >nul
echo   [OK]   Oude service verwijderd.

:skip_remove
:: 6. Wrapper en XML klaarzetten
echo.
echo   Configuratie gereedmaken...
copy /y "!WINSW_SOURCE!" "!WINSW_EXE!" >nul

powershell -NoProfile -Command "$xml = Get-Content -Raw '!ROOT_XML!'; $xml = $xml -replace '%%BASE%%\\.\\.\\..', '%CD%'; if (Get-Command node -ErrorAction SilentlyContinue) { $node = (Get-Command node).Source; $xml = $xml -replace '<executable>node</executable>', ('<executable>' + $node + '</executable>') }; [System.IO.File]::WriteAllText('!WINSW_XML!', $xml, [System.Text.Encoding]::UTF8)"
if not exist "!WINSW_XML!" (
    copy /y "!ROOT_XML!" "!WINSW_XML!" >nul
)
echo   [OK]   XML gereed: bin\winsw\%SVC_NAME%.xml

:: 7. WinSW Service installeren
echo.
echo   Service !SVC_NAME! registreren...
"!WINSW_EXE!" install
if !errorlevel! equ 0 goto :install_ok
echo.
echo   ==================================================
echo   [ERROR] Installatie mislukt!
echo   ==================================================
echo   Heb je dit script uitgevoerd als Administrator?
echo   Klik met de rechtermuisknop op install-service.bat
echo   en kies 'Als administrator uitvoeren'.
echo.
pause
exit /b 1

:install_ok
echo   [OK]   Service geregistreerd.

:: 8. Service starten
echo.
echo   Service !SVC_NAME! starten...
"!WINSW_EXE!" start
if !errorlevel! neq 0 (
    echo   [INFO] Starten via net start...
    net start !SVC_NAME!
)

:: 9. Status controleren
ping 127.0.0.1 -n 3 >nul
echo.
echo   Status controleren...
sc query !SVC_NAME! | findstr /i "STATE"

echo.
echo   ==================================================
echo   Installatie voltooid.
echo   Beheer:  restart-service.bat
echo   Status:  bin\winsw\!SVC_NAME!.exe status
echo   Logs:    logs\!SVC_NAME!.out.log
echo   ==================================================
echo.
pause
endlocal
exit /b 0
