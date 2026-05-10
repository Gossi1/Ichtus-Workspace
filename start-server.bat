@echo off
cd /d "%~dp0"
echo.
echo   ==================================================
echo          ICHTUS WORKSPACE - DEV SERVER
echo   ==================================================
echo.

:: Check for updates from GitHub
echo [Checking for updates...]

:: Detect current branch and its upstream
for /f "tokens=*" %%i in ('git rev-parse --abbrev-ref HEAD 2^>nul') do set BRANCH=%%i
for /f "tokens=*" %%i in ('git rev-parse --abbrev-ref @{u} 2^>nul') do set UPSTREAM=%%i
if "%BRANCH%"=="" set BRANCH=master
if "%UPSTREAM%"=="" set UPSTREAM=origin/master

git fetch 2>nul
if %errorlevel% neq 0 (
    echo [Skipping update check - Git not available or no remote]
    goto :start_server
)

:: Count how many commits we're behind the upstream
for /f "tokens=*" %%i in ('git rev-list HEAD...%UPSTREAM% --count 2^>nul') do set BEHIND=%%i
if "%BEHIND%"=="" (
    echo [Skipping update check - could not determine branch status]
    goto :start_server
)

if "%BEHIND%"=="0" (
    echo [Already up to date]
    goto :start_server
)

:: Updates available
echo.
echo   ==================================================
echo   Updates available! (%BEHIND% commit(s) behind %UPSTREAM%)
echo   ==================================================
echo.

:: Check for uncommitted local changes
git diff-index --quiet HEAD -- 2>nul
if %errorlevel% neq 0 (
    echo [WARNING] You have uncommitted local changes.
    echo Pulling may cause merge conflicts or fail.
    echo Consider committing or stashing your changes first.
    echo.
)

set /p CONFIRM="Pull the latest updates? (Y/N): "
if /i "%CONFIRM%"=="Y" (
    echo.
    echo [Pulling updates...]
    git pull
    if %errorlevel% neq 0 (
        echo [WARNING] Git pull failed. Continuing anyway...
    ) else (
        echo [Update successful!]
    )
) else (
    echo [Skipping update.]
)

:start_server
echo.

:: Check for virtual environment
if exist .venv\Scripts\python.exe (
    echo [Using virtual environment]
    .venv\Scripts\python.exe server.py --port 8080 --host 0.0.0.0
) else if exist .venv\bin\python.exe (
    echo [Using virtual environment]
    .venv\bin\python.exe server.py --port 8080 --host 0.0.0.0
) else if exist .venv\bin\python (
    echo [Using virtual environment]
    .venv\bin\python server.py --port 8080 --host 0.0.0.0
) else (
    echo [Using system Python]
    python server.py --port 8080 --host 0.0.0.0
)
pause
