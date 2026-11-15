@echo off
setlocal
cd /d "%~dp0"
set "result=1"
where node >nul 2>nul
if errorlevel 1 goto setup_required
where npm >nul 2>nul
if errorlevel 1 goto setup_required
if not exist "node_modules\tsx\package.json" goto setup_required
echo Starting custom recorder. Keep this window open while recording.
echo The recorder prints its local panel URL below.
call npm run qa:record -- %*
set "result=%errorlevel%"
if not "%result%"=="0" echo ERROR: Recorder stopped with exit code %result%. Review the output above.
goto finish
:setup_required
echo ERROR: Run Setup.bat first. Node.js and npm must be installed.
goto finish

:finish
if not defined WEB_QA_NO_PAUSE pause
exit /b %result%
