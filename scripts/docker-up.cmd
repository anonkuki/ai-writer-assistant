@echo off
setlocal

cd /d "%~dp0\.."

if not exist .env (
  if exist .env.docker.example (
    copy .env.docker.example .env >nul
    echo 已根据 .env.docker.example 创建 .env，请先补充 JWT_SECRET / SILICONFLOW_API_KEY 后再重新执行。
    exit /b 0
  )

  echo 缺少 .env，且未找到 .env.docker.example。
  exit /b 1
)

docker compose up --build -d