@echo off
setlocal
cd /d "%~dp0"
set "result=1"
where node >nul 2>nul
if errorlevel 1 goto setup_required
where npm >nul 2>nul
if errorlevel 1 goto setup_required
if not exist "node_modules\tsx\package.json" goto setup_required
echo Running saved application tests...
call npm run qa:run -- %*
set "result=%errorlevel%"
if not "%result%"=="0" echo Tests did not pass or no tests were found. Exit code: %result%.
if "%result%"=="0" echo Run finished. Use npm run qa:report to open the HTML report.
goto finish
:setup_required
echo ERROR: Run Setup.bat first. Node.js and npm must be installed.
goto finish

:finish
if not defined WEB_QA_NO_PAUSE pause
exit /b %result%
