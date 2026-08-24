@echo off
setlocal
title keeper doctor
rem  Eight checks, no archive needed, nothing written. It is the thing to run
rem  and paste back when keeper will not do something on this machine.
pushd "%~dp0."
echo.
"%~dp0node\node.exe" "%~dp0app\bin\keeper.mjs" doctor
popd
echo.
echo   press any key to close this window.
pause >nul
endlocal
