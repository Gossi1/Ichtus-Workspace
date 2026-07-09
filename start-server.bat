@echo off
setlocal EnableDelayedExpansion

cd /d "%~dp0"

echo.
echo   ==================================================
echo          ICHTUS WORKSPACE - DEV LAUNCHER
echo          (supervisor keeps all services alive)
echo   ==================================================
echo.
echo   One supervisor (Python, default :9090) now owns
echo   the lifetime of every service:
echo.
echo     - SPA HTTP server   (Python, server.py        :8080)
echo     - X32 OSC bridge    (Node,   x32/server.js    :3002)
echo     - Mic/IEM monitor   (Node,   mic-iem-server/  :3001)
echo.
echo   If a service crashes, the supervisor restarts it
echo   with capped exponential backoff (2s..30s). Logs
echo   land in  logs\<service>.log  (rotating, 5MB x 3).
echo   Stop everything with one Ctrl-C in this window.
echo.

rem Single-instance guard. If the previous supervisor is still alive
rem (PID file references a live process), DO NOT launch a duplicate.
rem Two supervisors on the same machine would race for ports :8080 /
rem :3002 / :3001 and the loser would log endless 'address already
rem in use' errors. We surface the live PID and let the operator
rem decide whether to `taskkill` it first or delete the stale file.
if exist supervisor.pid (
    for /f "tokens=* delims=" %%P in (supervisor.pid) do set SUP_PID=%%P
    rem `tasklist /FI "PID eq N"` exits 0 even when the filter has no
    rem match on some Windows builds, so we can't trust errorlevel
    rem alone. Pipe the table into `findstr` (which DOES reflect a
    rem hit/miss via its own errorlevel) and check that. The space
    rem on either side of the PID stops PIDs like 12 from matching
    rem PID 1234 inside another row.
    tasklist /NH /FI "PID eq !SUP_PID!" 2>nul | findstr /C:" !SUP_PID! " >nul 2>&1
    if !errorlevel! == 0 (
        echo.
        echo   ^╔══════════════════════════════════════════════════════════════╗
        echo   ^║  EEN SUPERVISOR IS AL ACTIEF (PID !SUP_PID!)                  ^║
        echo   ^║                                                              ^║
        echo   ^║  Voer uit om eerst netjes af te sluiten:                     ^║
        echo   ^║     taskkill /PID !SUP_PID!                                  ^║
        echo   ^║                                                              ^║
        echo   ^║  Of verwijder supervisor.pid handmatig als je zeker weet     ^║
        echo   ^║  dat er geen supervisor meer draait en je opnieuw wilt       ^║
        echo   ^║  starten.                                                    ^║
        echo   ^╚══════════════════════════════════════════════════════════════╝
        echo.
        pause
        exit /b 2
    )
    rem Stale pidfile from a previous crash — clean up.
    del /q supervisor.pid 2>nul
)

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
echo   ==================================================
echo   Starting supervisor...
echo   ==================================================
echo.

:: --------- Pick a Python interpreter ---------
:: Same venv detection the previous launcher used so an existing
:: dev workstation keeps booting unchanged.
set PYTHON=python
if exist .venv\Scripts\python.exe (
    set PYTHON=.venv\Scripts\python.exe
    echo   [PY]  using virtualenv  .venv\Scripts\python.exe
) else if exist .venv\bin\python.exe (
    set PYTHON=.venv\bin\python.exe
    echo   [PY]  using virtualenv  .venv\bin\python.exe
) else if exist .venv\bin\python (
    set PYTHON=.venv\bin\python
    echo   [PY]  using virtualenv  .venv\bin\python
) else (
    echo   [PY]  using system python
)

:: --------- Node presence (informational, not blocky) ---------
:: The supervisor handles missing-Node gracefully per-service; we
:: just warn so the operator isn't surprised when the X32 bridge and
:: mic-iem-server are skipped.
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo   [NODE] NOT FOUND - X32 bridge and mic-iem will be skipped.
    echo          Install from https://nodejs.org/ and re-run this launcher.
) else (
    echo   [NODE] found - checking dependencies...
)

:: --------- Ensure both Node projects have node_modules ---------
:: Done BEFORE spawning the supervisor so fast-crash-loop warnings
:: from a missing-deps child don't dominate the launch log.
if not exist "x32\node_modules" (
    echo         x32\node_modules missing - running npm install in x32\
    pushd x32
    call npm install
    set NPM_RC=!errorlevel!
    popd
    if !NPM_RC! neq 0 (
        echo         [WARN] npm install in x32\ exited with code !NPM_RC!.
    ) else (
        echo         x32\ npm install OK.
    )
) else (
    echo         x32\node_modules already present.
)

if not exist "mic-iem-server\node_modules" (
    echo         mic-iem-server\node_modules missing - running npm install
    pushd mic-iem-server
    call npm install
    set NPM_RC=!errorlevel!
    popd
    if !NPM_RC! neq 0 (
        echo         [WARN] npm install in mic-iem-server\ exited with code !NPM_RC!.
    ) else (
        echo         mic-iem-server\ npm install OK.
    )
) else (
    echo         mic-iem-server\node_modules already present.
)

:: --------- Launch the supervisor ---------
:: `cmd /k` keeps the supervisor's console open after it exits so
:: any error traceback is visible. The supervisor itself owns the
:: lifetime of all three child services; one Ctrl-C in that window
:: stops everything cleanly.
start "ICHTUS - Supervisor" cmd /k """%PYTHON%" supervisor.py --open"
echo         Command: %PYTHON% supervisor.py --open
echo         Window:  "ICHTUS - Supervisor"
echo         Status:  http://localhost:9090/
echo         SPA:     http://localhost:8080/Ichtus_SPA/

:post_start
echo.
echo   ==================================================
echo   Both services launched. Waiting up to 5s for ready...
echo   ==================================================
timeout /t 5 /nobreak > nul

where curl >nul 2>&1
if %errorlevel% equ 0 (
    echo   Probing endpoints...
    curl -sS --max-time 2 http://127.0.0.1:8080/api/test > nul 2>&1
    if !errorlevel! equ 0 (
        echo     [OK]   SPA HTTP server  - reachable on :8080
    ) else (
        echo     [WAIT] SPA HTTP server  - not yet, check "ICHTUS - SPA :8080"
        echo             window for traceback / port-in-use errors
    )
    curl -sS --max-time 2 http://127.0.0.1:3002/api/health > nul 2>&1
    if !errorlevel! equ 0 (
        echo     [OK]   X32 OSC bridge   - reachable on :3002
    ) else (
        echo     [WAIT] X32 OSC bridge   - not yet, check "ICHTUS - X32 Bridge :3002"
        echo             window for traceback / port-in-use errors
    )
) else (
    echo     SPA HTTP server : http://127.0.0.1:8080/Ichtus_SPA/
    echo     X32 OSC bridge  : http://127.0.0.1:3002/
    echo     (curl not on PATH - skipped live probe^)
)

echo.
echo   ==================================================
echo   Quick start - Stage Builder X32 push:
echo     1. Open      http://localhost:8080/Ichtus_SPA/
echo     2. Navigate to Stage Builder
echo     3. Confirm the X32 console IP in the action bar
echo        ^(default: 192.168.180.198 from the SPA's localStorage^)
echo     4. Open the X32 Library Map ^(bookshelf icon^) and add
echo        one row per role with name ^-^> slot
echo     5. Press "Push Coordinates to X32"
echo.
echo   Tip: you can close this window safely - both services
echo   keep running in their child windows until you Ctrl-C
echo   those ^(or close them via the X button^).
echo   ==================================================
echo.
pause
endlocal
