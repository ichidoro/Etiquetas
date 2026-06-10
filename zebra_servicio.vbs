' ZebraBridge Pro - Servicio de Impresion Local
' Este script inicia el servidor en segundo plano (sin ventana)
' Se coloca en la carpeta de Inicio de Windows para arrancar automaticamente

Dim WshShell, fso, appPath, scriptDir

Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Determinar ruta de la aplicacion
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

' Si el script esta en Startup, la app esta en la carpeta Etiquetas del usuario
If InStr(LCase(scriptDir), "startup") > 0 Then
    ' Buscar la carpeta Etiquetas en ubicaciones comunes
    Dim possiblePaths, foundPath
    possiblePaths = Array( _
        WshShell.ExpandEnvironmentStrings("%USERPROFILE%") & "\Etiquetas", _
        WshShell.ExpandEnvironmentStrings("%USERPROFILE%") & "\Desktop\Etiquetas", _
        WshShell.ExpandEnvironmentStrings("%USERPROFILE%") & "\Documents\Etiquetas", _
        "C:\Etiquetas" _
    )
    foundPath = ""
    Dim p
    For Each p In possiblePaths
        If fso.FolderExists(p) Then
            If fso.FileExists(p & "\package.json") Then
                foundPath = p
                Exit For
            End If
        End If
    Next
    If foundPath = "" Then
        WScript.Quit
    End If
    appPath = foundPath
Else
    appPath = scriptDir
End If

' Verificar que existe package.json
If Not fso.FileExists(appPath & "\package.json") Then
    WScript.Quit
End If

' Verificar que Node.js esta instalado
Dim nodeCheck
On Error Resume Next
WshShell.Run "cmd /c node --version > nul 2>&1", 0, True
If Err.Number <> 0 Then
    WScript.Quit
End If
On Error GoTo 0

' Iniciar el servidor en segundo plano
WshShell.Run "cmd /c cd /d """ & appPath & """ && npm run dev", 0, False
