@echo off
setlocal
cd /d "%~dp0"
set "result=1"
echo Setting up Web QA Framework...
where node >nul 2>nul
if errorlevel 1 goto missing_node
where npm >nul 2>nul
if errorlevel 1 goto missing_node
node -e "if(Number(process.versions.node.split('.')[0]) < 20) process.exit(1)"
if errorlevel 1 goto old_node
call npm ci
if errorlevel 1 goto install_failed
call npx --no-install playwright install chromium
if errorlevel 1 goto browser_failed
node -e "const fs=require('fs'); const p=require('@playwright/test').chromium.executablePath(); if(!fs.existsSync(p)) process.exit(1)"
if errorlevel 1 goto browser_failed
call npm run typecheck
if errorlevel 1 goto check_failed
set "result=0"
echo Setup complete. Double-click Start-Recorder.bat.
goto finish
:missing_node
echo ERROR: Install Node.js 20 or newer with npm, then reopen this launcher.
goto finish
:old_node
echo ERROR: Node.js 20 or newer is required.
goto finish
:install_failed
echo ERROR: Dependency installation failed. Check the npm output above.
goto finish
:browser_failed
echo ERROR: Chromium installation or verification failed. Check network access and the output above.
goto finish
:check_failed
echo ERROR: TypeScript verification failed. Check the output above.
goto finish

:finish
if not defined WEB_QA_NO_PAUSE pause
exit /b %result%
