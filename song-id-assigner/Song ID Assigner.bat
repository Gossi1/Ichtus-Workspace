@echo off
rem Song ID Assigner — desktop app (tkinter)
rem Start dezelfde logica als de webversie, zonder browser of server.
cd /d "%~dp0"
where python >nul 2>nul
if %errorlevel%==0 (
  python song_id_assigner_desktop.py
) else (
  py -3 song_id_assigner_desktop.py
)
if errorlevel 1 (
  echo.
  echo Fout bij het starten. Zorg dat Python 3 geinstalleerd is
  echo en beschikbaar is als "python" of "py" op de PATH.
  pause
)
