@echo off
chcp 65001 >nul
rem 인터넷 없이 이 노트북 한 대로 시연: 백엔드(AI 포함)와 웹 화면을 이 PC 에서 띄운다
rem 필요: Python (gridwitness-api 의존성 설치됨), Node.js, 옆 폴더 ..\gridwitness-api
cd /d "%~dp0"
if not exist "..\gridwitness-api\app\main.py" (
  echo [오류] ..\gridwitness-api 폴더가 없습니다
  pause
  exit /b 1
)
start "GridWitness 백엔드" cmd /k "cd /d "%~dp0..\gridwitness-api" && python -m uvicorn app.main:app --host 127.0.0.1 --port 8000"
if not exist "dist\index.html" (
  echo 웹 화면을 처음 한 번 빌드합니다...
  call npm run build
)
start "GridWitness 웹" cmd /k "set GW_API_TARGET=http://127.0.0.1:8000&& npx vite preview --port 4173 --strictPort"
echo 백엔드가 AI 모델을 불러오는 동안 기다립니다...
:wait
timeout /t 2 >nul
powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://127.0.0.1:8000/health).StatusCode } catch { exit 1 }" >nul 2>&1
if errorlevel 1 goto wait
start http://localhost:4173/
echo 준비됐습니다. 끝낼 때는 검은 창 두 개를 닫으세요.
