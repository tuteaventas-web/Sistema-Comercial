@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" (
    "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts/local.ts start
  ) else (
    echo Instale Node.js 24 y vuelva a ejecutar este archivo.
  )
) else (
  node scripts/local.ts start
)
pause
