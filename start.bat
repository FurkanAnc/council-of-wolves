@echo off
rem Kurtlar Konseyi: double-click to start (opens the browser)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
pause
