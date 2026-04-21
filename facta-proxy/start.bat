@echo off
REM Script para iniciar o proxy no Windows
REM Execute como administrador se quiser servico permanente (use NSSM)

cd /d "%~dp0"

if not exist .env (
  echo ERRO: arquivo .env nao encontrado. Copie .env.example para .env e edite.
  pause
  exit /b 1
)

REM Carrega .env
for /f "usebackq tokens=1,2 delims==" %%a in (.env) do (
  if not "%%a"=="" if not "%%a:~0,1%"=="#" set "%%a=%%b"
)

node server.js
pause
