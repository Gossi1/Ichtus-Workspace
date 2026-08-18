@echo off
setlocal EnableDelayedExpansion

:: ─────────────────────────────────────────────────────────────────────────
::  scripts\windows-setup.bat
::
::  WHY THIS EXISTS
::    Modern Git for Windows ships with a hardening check called
::    "safe.directory". When the Windows user that owns the .git/ folder
::    differs from the user running git, every command refuses with:
::
::        fatal: detected dubious ownership in repository at 'C:/Ichtus_apps'
::
::    This happens a lot when the workspace is:
::      - cloned by one Windows account and opened by another
::      - restored from a backup that was made under an admin account
::      - copied from another PC with different local accounts
::      - installed by one of our setup scripts that ran elevated
::
::    The fix is `git config --global --add safe.directory <path>`. This
::    script does that for the Ichtus workspace AND for any nested
::    repository it discovers, so future devs never trip over it again.
::
::  USAGE
::    Double-click, or run from any shell:
::        scripts\windows-setup.bat
::    Admin rights are NOT required (we only touch the user's own
::    gitconfig), but running elevated is harmless.
::
::  IDEMPOTENT
::    Safe to run as many times as you like. Entries that are already
::    configured are detected and skipped, never duplicated.
:: ─────────────────────────────────────────────────────────────────────────

echo.
echo   ==================================================
echo      ICHTUS - WINDOWS GIT SAFE.DIRECTORY SETUP
echo   ==================================================
echo.

where git >nul 2>&1
if !errorlevel! neq 0 (
    echo   [ERROR] Git niet gevonden in PATH.
    echo            Installeer Git for Windows: https://git-scm.com/download/win
    pause
    exit /b 1
)

:: Anchor on this script's own folder so it works no matter the cwd.
pushd "%~dp0.." >nul
set "WORKSPACE=%CD%"
popd >nul

echo   [INFO] Workspace: %WORKSPACE%
echo.

:: 1. The workspace itself.
call :AddSafeDir "%WORKSPACE%"

:: 2. Any nested checkout that has its own .git/ folder
::    (separate clone inside the workspace, not a submodule link -
::    submodule .git entries are gitlink FILES, not directories, so
::    dir /ad won't list them; the recursive call below will still
::    resolve them through `git rev-parse --show-toplevel`).
echo   [INFO] Scannen naar nested .git folders ...
for /f "delims=" %%R in ('
    dir /b /s /ad "%WORKSPACE%" 2^>nul
') do (
    if /i "%%~nxR"==".git" call :AddSafeDir "%%R"
)

echo.
echo   Huidige safe.directory lijst ^(git config --global --get-all^):
echo   ----------------------------------------------------------
git config --global --get-all safe.directory 2>nul
if !errorlevel! neq 0 echo   ^(geen entries^)
echo   ----------------------------------------------------------
echo.
echo   [OK] Klaar. Je krijgt geen "dubious ownership" foutmelding meer.
echo.
pause
exit /b 0


:: ─────────────────────────────────────────────────────────────────────────
::  :AddSafeDir <path-inside-repo>
::      Resolves the real repository root, checks whether it is already
::      trusted, and if not, whitelists it with safe.directory.
:: ─────────────────────────────────────────────────────────────────────────
:AddSafeDir
set "TARGET=%~1"
if "%TARGET%"=="" exit /b 0

:: The helper may be called with either a repo root or a .git folder;
:: strip a trailing "\.git" so we cd INTO the repo when probing.
if /i "%TARGET:~-4%"=="\.git" set "TARGET=%TARGET:~0,-4%"
if /i "%TARGET:~-4%"=="/.git" set "TARGET=%TARGET:~0,-4%"

pushd "%TARGET%" >nul 2>&1
if errorlevel 1 (
    echo   [WARN] Kan map niet openen, overslaan: %TARGET%
    exit /b 0
)
for /f "delims=" %%P in ('git rev-parse --show-toplevel 2^>nul') do set "CANON=%%P"
popd >nul 2>&1

if "!CANON!"=="" (
    echo   [WARN] Geen git repo, overslaan: %TARGET%
    exit /b 0
)

set "ALREADY=0"
for /f "delims=" %%E in ('git config --global --get-all safe.directory 2^>nul') do (
    if /i "%%E"=="!CANON!" set "ALREADY=1"
)

if "!ALREADY!"=="1" (
    echo   [SKIP] Al veilig: !CANON!
    exit /b 0
)

git config --global --add safe.directory "!CANON!" >nul 2>&1
if !errorlevel! equ 0 (
    echo   [ADD]  Toegevoegd: !CANON!
) else (
    echo   [FAIL] Kon niet toevoegen: !CANON!
)
exit /b 0
