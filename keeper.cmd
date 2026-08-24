@echo off
setlocal EnableDelayedExpansion
title keeper

rem ---------------------------------------------------------------------
rem  Double click this. It starts keeper and opens your browser, and then
rem  you drag a folder of photographs onto the page.
rem
rem  It exists because the person keeper is for is a photographer, not a
rem  developer, and every step between them and their own pictures is a
rem  step where they give up. This is the whole setup: node once, then
rem  this file forever.
rem
rem  Dragging a folder onto this file works too and skips the drag on the
rem  page. Both end up in the same place.
rem
rem  It is deliberately loud when something is missing and silent when it
rem  is not. Nothing here touches the archive. It installs into its own
rem  folder and starts the same command a terminal would.
rem ---------------------------------------------------------------------

rem run from the folder this file is in, whatever folder was dragged from
pushd "%~dp0."

echo.
echo   keeper
echo.

rem --- node ------------------------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo   node is not installed, and keeper is a node program.
  echo.
  echo   the short way, in a terminal:
  echo       winget install OpenJS.NodeJS.LTS
  echo.
  echo   or download the LTS installer from  https://nodejs.org
  echo   then close this window, open it again, and run this file.
  echo.
  goto :stop
)

rem 20 or newer. `node -v` prints v20.19.1, so cut the v and take the major.
set "NODEMAJOR=0"
for /f "tokens=1 delims=." %%v in ('node -v') do set "NODEMAJOR=%%v"
set "NODEMAJOR=!NODEMAJOR:v=!"
if !NODEMAJOR! LSS 20 (
  for /f %%v in ('node -v') do echo   node %%v is installed and keeper needs 20 or newer.
  echo   install the LTS from  https://nodejs.org  and run this file again.
  echo.
  goto :stop
)

rem --- dependencies ----------------------------------------------------
rem  One dependency, sharp, and it carries a compiled binary. First run
rem  fetches it and every run after this finds it already there.
if not exist "node_modules\sharp" (
  echo   first run, so this fetches what keeper needs. one minute, once.
  echo.
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo   that did not finish. it is almost always the network or a
    echo   corporate proxy. try again on a different connection.
    echo.
    goto :stop
  )
  echo.
  rem  First run only, and this is the whole reason it exists: it says what
  rem  this machine can and cannot do before anybody has an archive open to
  rem  be disappointed by, and the answer can be pasted to whoever sent you
  rem  this. It never stops the run.
  node bin\keeper.mjs doctor
)

rem --- which folder ----------------------------------------------------
rem  A folder dragged onto this file, if there was one. Otherwise keeper
rem  starts on an empty folder and waits, and the page says to drag one on.
set "ARCHIVE=%~1"
if "!ARCHIVE!"=="" (
  if not exist "%~dp0start\" mkdir "%~dp0start"
  set "ARCHIVE=%~dp0start"
)

if not exist "!ARCHIVE!\" (
  echo.
  echo   that is not a folder:  !ARCHIVE!
  echo.
  goto :stop
)

rem --- go --------------------------------------------------------------
echo   keeper is starting. your browser will open on its own, and the
echo   address is printed just below in case it does not.
echo.
echo   drag a folder of photographs onto the page to read it.
echo.
echo   leave this window open while you work. close it when you are done.
echo.
node bin\keeper.mjs "!ARCHIVE!"

rem keeper exits when the window is closed or on ctrl c, and a batch file
rem that vanishes takes its error message with it.
echo.

:stop
popd
echo   press any key to close this window.
pause >nul
endlocal
