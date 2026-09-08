@echo off
chcp 65001 >nul
set "SCRIPT_DIR=%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%desktop\launcher\stop-personal-growth.ps1"
if errorlevel 1 (
  echo.
  echo 停止失败，请查看上方提示。
  pause
)
