@echo off
chcp 65001 >nul
echo Updating E-Book Library database...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0app\scripts\index-ebooks.ps1"
echo.
pause
