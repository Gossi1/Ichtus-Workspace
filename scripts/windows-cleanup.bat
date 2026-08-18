@echo off
setlocal EnableDelayedExpansion

:: ─────────────────────────────────────────────────────────────────────────
::  scripts\windows-cleanup.bat
::
::  PURPOSE
::    Counterpart to scripts\windows-setup.bat. Removes the
::    `safe.directory` entries this workspace added to your git config,
::    so reinstalling or moving to a fresh Windows account doesn't leave
::    stale entries behind.
::
::  USAGE
::    Double-click, or run from any shell:
::        scripts\windows-cleanup.bat
::
::  SAFE
::    Only touches entries whose path is INSIDE the workspace. Global
::    safe.directory entries from other projects are left untouched.
::
::  WHEN TO USE
::    - You're uninstalling Ichtus from this PC.
::    - You moved the workspace to a folder where the ownership is now
::      correct, and want to start fresh.
::    - You want to debug "why is safe.directory still pointing at X?"
::      and prefer a clean slate.
:: ─────────────────────────────────────────────────────────────────────────

echo.
echo   ==================================================
echo      ICHTUS - WINDOWS GIT SAFE.DIRECTORY CLEANUP
echo   ==================================================
echo.

pushd "%~dp0.." >nul
set "WORKSPACE=%CD%"
popd >nul

echo   Workspace:            %WORKSPACE%
echo   Huidige safe.directory regels (worden beoordeeld):
echo   ----------------------------------------------------------
git config --global --get-all safe.directory 2>nul
if !errorlevel! neq 0 echo   ^(geen entries^)
echo   ----------------------------------------------------------
echo.

set "CONFIRM="
set /p "CONFIRM=Verwijder regels die binnen deze workspace vallen? (J/N) > "
if /i not "!CONFIRM!"=="J" (
    echo.
    echo   Geannuleerd. Niets gewijzigd.
    pause
    exit /b 0
)

echo.

set "REMOVED=0"
set "KEPT=0"
for /f "delims=" %%E in ('git config --global --get-all safe.directory 2^>nul') do (
    set "ENTRY=%%E"
    echo "!ENTRY!"| findstr /i /b /c:"%WORKSPACE%" >nul 2>&1
    if !errorlevel! equ 0 (
        git config --global --unset safe.directory "!ENTRY!" >nul 2>&1
        if !errorlevel! equ 0 (
            echo   [REM]  !ENTRY!
            set /a REMOVED+=1
        ) else (
            echo   [FAIL] !ENTRY!
        )
    ) else (
        set /a KEPT+=1
    )
)

echo.
echo   Klaar. !REMOVED! regel(s) verwijderd, !KEPT! andere regels onaangeraakt.
echo.
pause
exit /b 0
