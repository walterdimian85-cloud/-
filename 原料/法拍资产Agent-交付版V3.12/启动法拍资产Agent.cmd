@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-agent.ps1"
set "AGENT_EXIT=%ERRORLEVEL%"
if not "%AGENT_EXIT%"=="0" (
  echo.
  echo Agent startup failed. See agent-startup-error.log in this folder.
  pause
)
exit /b %AGENT_EXIT%
