@echo off
:: ╔══════════════════════════════════════════════════════════════╗
:: ║  ZebraBridge Print Server — Instalador y Lanzador           ║
:: ║                                                              ║
:: ║  Funciones:                                                  ║
:: ║  1. Verifica que Node.js esté instalado                     ║
:: ║  2. Se auto-instala en el Inicio de Windows (oculto)        ║
:: ║  3. Ejecuta el servidor de impresión en segundo plano       ║
:: ║  4. El usuario NO ve terminal — corre invisible              ║
:: ╚══════════════════════════════════════════════════════════════╝

:: Get the directory where this .bat lives
set "BRIDGE_DIR=%~dp0"
set "BRIDGE_SCRIPT=%BRIDGE_DIR%print-bridge.mjs"
set "VBS_LAUNCHER=%BRIDGE_DIR%print-bridge-silent.vbs"
set "STARTUP_LINK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\ZebraBridge.lnk"

:: ── 1. Check Node.js ─────────────────────────────────────────
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo ❌ Node.js no está instalado.
    echo    Descárgalo de https://nodejs.org
    echo    Luego ejecuta este archivo de nuevo.
    pause
    exit /b 1
)

:: ── 2. Check if print-bridge.mjs exists ──────────────────────
if not exist "%BRIDGE_SCRIPT%" (
    echo ❌ No se encontró print-bridge.mjs
    echo    Debe estar en la misma carpeta que este .bat
    pause
    exit /b 1
)

:: ── 3. Create VBS silent launcher (hides the terminal) ───────
echo Creating silent launcher...
(
    echo Set WshShell = CreateObject^("WScript.Shell"^)
    echo WshShell.CurrentDirectory = "%BRIDGE_DIR%"
    echo WshShell.Run "node ""%BRIDGE_SCRIPT%""", 0, False
) > "%VBS_LAUNCHER%"

:: ── 4. Create Windows Startup shortcut ───────────────────────
echo Installing auto-start...
powershell -NoProfile -Command ^
  "$ws = New-Object -ComObject WScript.Shell; ^
   $sc = $ws.CreateShortcut('%STARTUP_LINK%'); ^
   $sc.TargetPath = '%VBS_LAUNCHER%'; ^
   $sc.WorkingDirectory = '%BRIDGE_DIR%'; ^
   $sc.Description = 'ZebraBridge Print Server'; ^
   $sc.Save()"

:: ── 5. Kill any existing instance ────────────────────────────
echo Stopping previous instances...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000 " ^| findstr "LISTENING"') do (
    taskkill /PID %%a /F >nul 2>nul
)
timeout /t 1 /nobreak >nul

:: ── 5b. Open firewall for LAN access ────────────────────────
echo Opening firewall for WiFi printing...
netsh advfirewall firewall delete rule name="ZebraBridge" >nul 2>nul
netsh advfirewall firewall add rule name="ZebraBridge" dir=in action=allow protocol=TCP localport=3000 >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo [OK] Firewall abierto - otros PCs en la WiFi pueden imprimir
) else (
    echo [AVISO] No se pudo abrir el firewall. Ejecuta como administrador si necesitas imprimir desde otros PCs.
)

:: ── 6. Launch silently NOW ───────────────────────────────────
echo Starting ZebraBridge Print Server...
start "" wscript.exe "%VBS_LAUNCHER%"

:: ── 7. Wait and verify ───────────────────────────────────────
timeout /t 3 /nobreak >nul
powershell -NoProfile -Command ^
  "try { $r = Invoke-WebRequest -Uri 'http://localhost:3000/health' -UseBasicParsing -TimeoutSec 5; ^
   $j = $r.Content | ConvertFrom-Json; ^
   Write-Host ''; ^
   Write-Host '╔══════════════════════════════════════════════════╗'; ^
   Write-Host '║  ✅ ZebraBridge Print Server ACTIVO               ║'; ^
   Write-Host '║                                                    ║'; ^
   Write-Host '║  🌐 Puerto: http://localhost:3000                  ║'; ^
   Write-Host '║  📌 Auto-inicio: CONFIGURADO                      ║'; ^
   Write-Host '║  🔒 Modo: Segundo plano (invisible)               ║'; ^
   Write-Host '║                                                    ║'; ^
   Write-Host '║  Ya puedes usar la app desde la nube.             ║'; ^
   Write-Host '║  Esta ventana se cerrará automáticamente.          ║'; ^
   Write-Host '╚══════════════════════════════════════════════════╝'; ^
   Write-Host ''; ^
  } catch { ^
   Write-Host '❌ Error: El servidor no respondió.'; ^
   Write-Host '   Revisa que el puerto 3000 no esté en uso.'; ^
  }"

:: Auto-close after 8 seconds
timeout /t 8 /nobreak >nul
