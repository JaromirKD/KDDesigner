@echo off
rem Overnight soak test (tools/stress/soak.js): runs until 08:00, then puts the original project
rem back. Keep the laptop plugged in with the lid open. Results: tools\stress\soak-results\
rem Other controller or end time: "Overnight stress test.cmd" 172.16.1.50 --until 07:00
title KD Designer overnight stress test - Ctrl+C stops it and puts the project back
set IP=%1
if "%IP%"=="" set IP=172.16.1.171
if not "%1"=="" shift
node "%~dp0soak.js" %IP% %1 %2 %3 %4 %5 %6
echo.
echo Finished. The report is report.txt in the newest folder in tools\stress\soak-results
pause
