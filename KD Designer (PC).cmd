@echo off
rem Double-click to work on a show on this PC: pick (or name) a show, the mock starts
rem and the browser opens. Close this window to stop. A show folder can also be
rem dropped onto this file.
setlocal EnableDelayedExpansion
title KD Designer (PC)
cd /d "%~dp0"
where node >nul 2>nul || (
  echo Node.js is not installed. Get it from https://nodejs.org and try again.
  pause
  exit /b 1
)
set "SHOWS=%USERPROFILE%\Documents\KD Shows"
if not "%~1"=="" (
  set "SHOW=%~f1"
  goto port
)

:menu
cls
echo.
echo   KD Designer - work on a show on this PC
echo   Shows are kept in %SHOWS%
echo.
set n=0
if exist "%SHOWS%\" for /d %%d in ("%SHOWS%\*") do (
  set /a n+=1
  set "show!n!=%%~fd"
  echo     !n!  %%~nxd
)
echo     0  Sample project (data\show)
echo.
set "pick="
set /p "pick=  Number of a show, or a name for a new one: "
if not defined pick goto menu
echo !pick!| findstr /r "^[0-9][0-9]*$" >nul && (
  if "!pick!"=="0" (
    set "SHOW=%~dp0data\show"
    goto port
  )
  if defined show!pick! (
    set "SHOW=!show%pick%!"
    goto port
  )
  goto menu
)
set "SHOW=%SHOWS%\!pick!"

:port
rem First free port from 8080 up, so it can run next to another mock.
set PORT=8080
:nextport
netstat -an | find ":%PORT% " | find "LISTENING" >nul && (
  set /a PORT+=1
  goto nextport
)
echo.
echo   Show:    !SHOW!
echo   Browser: http://localhost:%PORT%
echo   Close this window to stop (save in the browser first).
echo.
rem Open the browser once the mock is listening (ping = a 2 s wait that also works without a keyboard).
if not defined KD_NOBROWSER start "" /b cmd /c "ping -n 3 127.0.0.1 >nul & start "" http://localhost:%PORT%"
node tools\mock-server.js %PORT% "!SHOW!"
echo.
echo   The mock stopped.
pause
