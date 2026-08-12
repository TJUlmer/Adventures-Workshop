@echo off
title Adventures Workshop
cd /d "%~dp0"

rem Starts the Vite dev server and opens the workshop in your browser.
rem Keep this window open while you work: closing it stops the server.

if not exist "node_modules\" (
  echo Installing dependencies. This only happens once, and takes a minute.
  echo.
  call npm install
  if errorlevel 1 goto failed
)

echo Starting the dev server. Your browser opens once it is ready.
echo Close this window, or press Ctrl+C, to stop it.
echo.

call npm run dev -- --open

echo.
echo The dev server has stopped.
pause
exit /b 0

:failed
echo.
echo npm install failed. The message above should say why.
echo Check that Node.js is installed: run "node --version".
pause
exit /b 1
