@echo off
setlocal
title keeper

rem ---------------------------------------------------------------------
rem  Double click this.
rem
rem  Everything keeper needs is in this folder, including node, so there is
rem  nothing to install and nothing to have installed already. It starts,
rem  your browser opens, and you drag a folder of photographs onto the page.
rem
rem  Dragging a folder onto this file works too and skips the drag on the
rem  page.
rem
rem  This window is how you stop keeper. Close it and keeper stops. There is
rem  a quit button on the page as well and it does the same thing.
rem ---------------------------------------------------------------------

pushd "%~dp0."

echo.
echo   keeper
echo.
echo   your browser will open on its own. the address is printed below in
echo   case it does not.
echo.
echo   drag a folder of photographs onto the page to read it.
echo.
echo   closing this window stops keeper. nothing is lost when you do:
echo   every tag and every crop is written the moment you make it.
echo.

rem The bundled runtime, never whatever happens to be on the path. A machine
rem with an old node on it would otherwise pick that one up and fail in a way
rem that reads as keeper being broken.
"%~dp0node\node.exe" "%~dp0app\bin\keeper.mjs" app %*

rem A batch file that vanishes takes its error message with it, and the error
rem is the only thing on screen worth reading when this goes wrong.
echo.
popd
echo   keeper has stopped. press any key to close this window.
pause >nul
endlocal
