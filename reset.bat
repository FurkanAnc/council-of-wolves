@echo off
rem Forget the saved API key and connection, then start (the setup screen opens)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" -Reset
pause
