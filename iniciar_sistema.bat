@echo off
echo Iniciando Sistema de Asistencia Docente...
echo No cierres esta ventana mientras uses la aplicacion.
echo.
echo 1. Verificando Node.js...
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js no esta instalado. Por favor instalalo desde https://nodejs.org/
    pause
    exit /b
)

echo 2. Verificando librerias (esto puede tardar la primera vez)...
if not exist node_modules (
    echo Instalando dependencias necesarias...
    call npm install
)

echo 3. Iniciando servidor...
call npm run dev
pause
pause
