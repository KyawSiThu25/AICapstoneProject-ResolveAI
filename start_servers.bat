@echo off
echo ========================================================
echo Starting Resolve AI System (Backend + 2 Portals)
echo ========================================================
echo.

echo [1/3] Starting Backend API Server (Port 8000)...
start "Resolve AI - Backend (Port 8000)" cmd /k "cd /d "%~dp0backend" && .\venv\Scripts\uvicorn main:app --host 127.0.0.1 --port 8000 --reload"

echo [2/3] Starting Customer Portal (Port 5173)...
start "Resolve AI - Customer Portal (Port 5173)" cmd /k "cd /d "%~dp0frontend" && npm run dev:customer"

echo [3/3] Starting Business Agent Portal (Port 5174)...
start "Resolve AI - Agent Operations (Port 5174)" cmd /k "cd /d "%~dp0frontend" && npm run dev:business"

echo.
echo All services launched!
echo - Backend API:        http://127.0.0.1:8000 (Docs: http://127.0.0.1:8000/docs)
echo - Customer Portal:    http://127.0.0.1:5173 (or http://127.0.0.1:5173/chat)
echo - Business Portal:    http://127.0.0.1:5174
echo.
pause
