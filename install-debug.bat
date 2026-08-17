@echo off
setlocal

cd /d "%~dp0"

set "TRACE=C:\Ichtus_apps\install-trace.log"

echo BEGIN install-debug wrapper at %DATE% %TIME% > "%TRACE%"
echo CWD: %CD%                          >> "%TRACE%"
echo Args: %*                            >> "%TRACE%"
echo.                                     >> "%TRACE%"
echo === install-service.bat output below ===  >> "%TRACE%"
echo.                                     >> "%TRACE%"

"C:\Ichtus_apps\install-service.bat" 1>>"%TRACE%" 2>&1
set "RC=%errorlevel%"

echo.                                     >> "%TRACE%"
echo === end of install-service.bat output === >> "%TRACE%"
echo Exitcode: %RC%                       >> "%TRACE%"
echo END install-debug wrapper at %TIME%  >> "%TRACE%"

echo Logbestand: %TRACE%
echo.
echo === Eerste 60 regels van de trace ===
type "%TRACE%"
echo.
echo === Laatste 60 regels van de trace ===
powershell -NoProfile -Command "Get-Content '%TRACE%' | Select-Object -Last 60"

pause
endlocal
