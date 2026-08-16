@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
title DSH Desktop

cd /d "%~dp0"

echo ============================================================
echo   dsh-wallpaper-engine desktop
echo   dsh web:  http://127.0.0.1:3080
echo ============================================================
echo.

rem Detect an existing dsh web listener on port 3080.
set "LISTEN_PID="
for /f "tokens=5" %%p in ('netstat -ano -p tcp ^| findstr /R /C:":3080 .*0.0.0.0:0" /C:":3080 .*\[::\]:0"') do set "LISTEN_PID=%%p"

if defined LISTEN_PID goto web-ready

echo [info] Starting dsh web in a new window...
start "dsh-web" cmd /c "dsh web"
echo [info] Waiting for the web server...
set /a WEB_WAIT_TRIES=0
:wait-web
set "LISTEN_PID="
for /f "tokens=5" %%p in ('netstat -ano -p tcp ^| findstr /R /C:":3080 .*0.0.0.0:0" /C:":3080 .*\[::\]:0"') do set "LISTEN_PID=%%p"
if not defined LISTEN_PID (
  set /a WEB_WAIT_TRIES+=1
  if !WEB_WAIT_TRIES! LSS 30 (
    timeout /t 1 /nobreak >nul
    goto wait-web
  )
  echo [error] dsh web did not start on port 3080.
  echo         Install dsh CLI first, or start dsh web manually.
  pause
  exit /b 1
)
:web-ready

cd /d "%~dp0desktop"
if not exist node_modules\electron\dist\electron.exe (
  echo [info] Installing desktop dependencies...
  call pnpm install
)
echo [info] Launching the desktop shell...
call pnpm run start
if errorlevel 1 (
  echo.
  echo [error] The desktop shell exited with an error.
  echo         Build it first: pnpm --dir desktop run build
  pause
  exit /b 1
)
exit /b 0
