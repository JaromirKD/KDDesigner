@echo off
rem Double-click to work on shows on this PC: the launcher page opens in the browser
rem (shows, controllers on the network and USB). Close this window to stop it and every
rem show it opened. A show folder can also be dropped onto this file.
title KD Designer (PC)
cd /d "%~dp0"
where node >nul 2>nul || (
  echo Node.js is not installed. Get it from https://nodejs.org and try again.
  pause
  exit /b 1
)
node tools\launcher.js %1
echo.
echo   The launcher stopped.
pause
