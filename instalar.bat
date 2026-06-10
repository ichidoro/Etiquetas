@echo off
chcp 65001 >nul 2>&1
echo ============================================
echo   ZebraBridge Pro - Instalacion Completa
echo ============================================
echo.

:: Verificar Node.js
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js no esta instalado.
    echo Descarga desde: https://nodejs.org
    pause
    exit /b 1
)
echo [OK] Node.js encontrado

:: Verificar Git
git --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Git no esta instalado.
    echo Descarga desde: https://git-scm.com
    pause
    exit /b 1
)
echo [OK] Git encontrado

echo.
echo Descargando aplicacion...
if exist "Etiquetas" (
    cd Etiquetas
    git pull
) else (
    git clone https://github.com/ichidoro/Etiquetas.git
    cd Etiquetas
)

echo.
echo Creando configuracion...
(
echo TURSO_DATABASE_URL="libsql://unicodiq-ichidoro.aws-us-east-1.turso.io"
echo TURSO_AUTH_TOKEN="eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODA5NTA0OTMsImlkIjoiMDE5ZWE4ZWItY2QwMS03ODliLWJlOTMtZGZkMGY1YzFjMjJlIiwicmlkIjoiZTJhYzM5YzEtYjhhMS00NzFmLTk3YjctN2YyNjg5ZGFjZjAwIn0.iNI0xsEowQvZt4PoD4mcxrjfzyxwgU5tmY0VZ1yZImyB7IBZ_FihHAU5n7Acc6npckKP0C5xuziIOuW3lAa9Ag"
) > .env
echo [OK] Configuracion creada

echo.
echo Instalando dependencias (esto puede tardar unos minutos)...
call npm install

echo.
echo ============================================
echo   Configurando inicio automatico...
echo ============================================

:: Copiar servicio VBS a carpeta de Inicio de Windows
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
copy /Y "zebra_servicio.vbs" "%STARTUP%\zebra_servicio.vbs" >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Servicio configurado para iniciar con Windows
) else (
    echo [AVISO] No se pudo configurar el inicio automatico
)

echo.
echo ============================================
echo   Iniciando ZebraBridge Pro...
echo   
echo   El servidor de impresion se iniciara
echo   automaticamente cada vez que enciendas
echo   el computador.
echo   
echo   Abre en tu navegador:
echo   https://zebra-bridge-pro-684852789183.us-central1.run.app
echo ============================================
echo.

:: Iniciar ahora
call npm run dev
