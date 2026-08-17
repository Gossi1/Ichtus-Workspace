@echo off
setlocal

:: ============================================
::  Build WorshipTools Chrome Extension (.crx)
:: ============================================

set "EXT_DIR=%~dp0extensions\worshiptools-sync"
set "OUTPUT_DIR=%~dp0extensions"
set "CRX_FILE=%OUTPUT_DIR%\worshiptools-sync.crx"

echo.
echo   ==================================================
echo     WORSHIPTOOLS EXTENSION BUILDER
echo   ==================================================
echo.

:: Check if extension folder exists
if not exist "%EXT_DIR%" (
    echo   [ERROR] Extension map niet gevonden: %EXT_DIR%
    pause
    exit /b 1
)

:: Check if manifest.json exists
if not exist "%EXT_DIR%\manifest.json" (
    echo   [ERROR] manifest.json niet gevonden in %EXT_DIR%
    pause
    exit /b 1
)

:: Find Chrome
set "CHROME_PATH="
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    set "CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe"
) else if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    set "CHROME_PATH=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
) else if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" (
    set "CHROME_PATH=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
)

if "%CHROME_PATH%"=="" (
    echo   [ERROR] Google Chrome niet gevonden.
    echo   Installeer Chrome of pak handmatig:
    echo     chrome.exe --pack-extension="%EXT_DIR%"
    pause
    exit /b 1
)

echo   [INFO] Chrome: %CHROME_PATH%
echo   [INFO] Extension: %EXT_DIR%
echo.

:: Pack the extension
echo   Extension packen...
"%CHROME_PATH%" --pack-extension="%EXT_DIR%" --pack-extension-key="%OUTPUT_DIR%\worshiptools-sync.pem" 2>nul

:: Wait a moment for Chrome to finish
timeout /t 2 /nobreak >nul

:: Check if CRX was created (Chrome puts it next to the source folder)
set "FOUND_CRX="
if exist "%OUTPUT_DIR%\worshiptools-sync.crx" (
    set "FOUND_CRX=%OUTPUT_DIR%\worshiptools-sync.crx"
) else if exist "%EXT_DIR%\..\worshiptools-sync.crx" (
    set "FOUND_CRX=%EXT_DIR%\..\worshiptools-sync.crx"
)

if "%FOUND_CRX%"=="" (
    echo   [WARN] Chrome heeft geen .crx bestand aangemaakt.
    echo.
    echo   Alternatief: pak handmatig via PowerShell:
    echo     Compress-Archive -Path "%EXT_DIR%\*" -DestinationPath "%OUTPUT_DIR%\worshiptools-sync.zip"
    echo     Ren "%OUTPUT_DIR%\worshiptools-sync.zip" "worshiptools-sync.crx"
    echo.
    echo   Of sleep de extension map direct naar chrome://extensions/
    pause
    exit /b 1
)

:: Copy to root for easy access
copy "%FOUND_CRX%" "%~dp0worshiptools-sync.crx" >nul 2>&1

echo.
echo   ==================================================
echo   [OK] Extension gepacked!
echo   ==================================================
echo.
echo   Bestanden:
echo     CRX:  %~dp0worshiptools-sync.crx
echo     PEM:  %OUTPUT_DIR%\worshiptools-sync.pem
echo.
echo   Installatie:
echo     1. Open chrome://extensions/
echo     2. Sleep worshiptools-sync.crx naar het scherm
echo     3. Klik "Extension toevoegen"
echo.
echo   Of sleep de map extensions\worshiptools-sync\
echo   direct naar chrome://extensions/ (als Developer Mode aan staat)
echo   ==================================================
echo.

pause
endlocal
