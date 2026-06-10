@echo off
echo ============================================
echo   ZebraBridge Pro - Instalacion Rapida
echo ============================================
echo.

:: Verificar Node.js
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js no esta instalado.
    echo Descarga e instala desde: https://nodejs.org
    echo Luego ejecuta este script de nuevo.
    pause
    exit /b 1
)
echo [OK] Node.js encontrado

:: Verificar Git
git --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Git no esta instalado.
    echo Descarga e instala desde: https://git-scm.com
    echo Luego ejecuta este script de nuevo.
    pause
    exit /b 1
)
echo [OK] Git encontrado

:: Clonar repositorio
echo.
echo Clonando repositorio...
if exist "Etiquetas" (
    echo [INFO] Carpeta Etiquetas ya existe, actualizando...
    cd Etiquetas
    git pull
) else (
    git clone https://github.com/ichidoro/Etiquetas.git
    cd Etiquetas
)

:: Crear archivo .env
echo.
echo Creando configuracion de base de datos...
(
echo # Turso Database Configuration ^(Cloud^)
echo TURSO_DATABASE_URL="libsql://unicodiq-ichidoro.aws-us-east-1.turso.io"
echo TURSO_AUTH_TOKEN="eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODA5NTA0OTMsImlkIjoiMDE5ZWE4ZWItY2QwMS03ODliLWJlOTMtZGZkMGY1YzFjMjJlIiwicmlkIjoiZTJhYzM5YzEtYjhhMS00NzFmLTk3YjctN2YyNjg5ZGFjZjAwIn0.iNI0xsEowQvZt4PoD4mcxrjfzyxwgU5tmY0VZ1yZImyB7IBZ_FihHAU5n7Acc6npckKP0C5xuziIOuW3lAa9Ag"
) > .env
echo [OK] Archivo .env creado

:: Instalar dependencias
echo.
echo Instalando dependencias (esto puede tardar unos minutos)...
call npm install
echo [OK] Dependencias instaladas

:: Ejecutar
echo.
echo ============================================
echo   TODO LISTO! Iniciando ZebraBridge Pro...
echo ============================================
echo.
echo   Abre en el navegador: http://localhost:3000
echo.
echo   Para detener: presiona Ctrl+C
echo ============================================
echo.
call npm run dev
