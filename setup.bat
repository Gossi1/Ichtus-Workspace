@echo off
setlocal EnableDelayedExpansion

:: ──────────────────────────────────────────
::  One-shot Ichtus setup launcher
:: ──────────────────────────────────────────
echo.
echo   ==================================================
echo      ICHTUS WORKSPACE - ONE-SHOT SETUP
echo   ==================================================
echo.
echo   Dit venster sluit automatisch. Open PowerShell
echo   "Als administrator uitvoeren" als je deze foutmelding
echo   ziet: "Dit script vereist admin-rechten".
echo.

:: Probeer setup.ps1 lokaal (in dezelfde map als setup.bat)
if exist "%~dp0setup.ps1" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" %*
) else (
    :: Geen lokale setup.ps1 — download 'm via GitHub raw en draai in-memory.
    echo   Geen lokale setup.ps1 gevonden — worden opgehaald van GitHub...
    echo.
    powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/Gossi1/Ichtus-Workspace/master/setup.ps1 | iex"
)

set RC=%errorlevel%

echo.
if !RC!==0 (
    echo   ==================================================
    echo     Installatie voltooid.
    echo     Open:   http://localhost:8080/Ichtus_SPA/
    echo   ==================================================
) else (
    echo   ==================================================
    echo     Setup faalde ^(exit !RC!^). Bekijk de output hierboven.
    echo   ==================================================
)
echo.
pause
endlocal
