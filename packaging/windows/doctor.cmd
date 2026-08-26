@echo off
setlocal
title keeper doctor
rem  Nine checks, no archive needed, nothing written except the report itself.
rem  It is the thing to run and send back when keeper will not do something on
rem  this machine.
rem
rem  THE REPORT IS WRITTEN TO A FILE AS WELL AS THE WINDOW, because the whole
rem  point of it is being sent to somebody, and selecting text out of a
rem  console window is a thing most people have never had to do. The path is
rem  printed at the end so there is something to drag into a message.
rem
rem  IT ONLY WAITS FOR A KEY WHEN IT WAS DOUBLE CLICKED. Ending in `pause`
rem  unconditionally is right for a shortcut and wrong for everything else:
rem  it made the one command whose entire purpose is producing text that gets
rem  pasted somewhere impossible to run from anything but a hand on a mouse.
rem  Pass any argument and it prints and exits.
set "report=%LOCALAPPDATA%\keeper\doctor.txt"
if not exist "%LOCALAPPDATA%\keeper" mkdir "%LOCALAPPDATA%\keeper" >nul 2>&1
pushd "%~dp0."
echo.
"%~dp0node\node.exe" "%~dp0app\bin\keeper.mjs" doctor > "%report%" 2>&1
type "%report%"
popd
echo.
echo   this report is also saved at
echo   %report%
if not "%~1"=="" goto done
echo.
echo   press any key to close this window.
pause >nul
:done
endlocal
