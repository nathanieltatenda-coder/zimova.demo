@echo off
cd /d "%~dp0"
echo =====================================
echo  ZIMOVA - Move Your Way
echo =====================================
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 18 or newer, then run this file again.
  echo Download: https://nodejs.org/
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing required packages. This needs an internet connection...
  call npm install
  if errorlevel 1 (
    echo npm install failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)
if not exist .env if not exist data\db.json (
  copy .env.example .env >nul
  echo First start: a settings file called .env was created.
  echo In Notepad set ADMIN_EMAIL and ADMIN_PASSWORD, save, then close Notepad.
  notepad .env
)
echo.
echo Starting ZIMOVA. Keep this window open while using the website.
start "" /min cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:3000"
call npm start
pause
