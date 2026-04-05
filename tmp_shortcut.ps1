$WshShell = New-Object -comObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut("C:\Users\ZONA FRESH\Desktop\Caja Fresh POS.lnk")
$Shortcut.TargetPath = "C:\Users\ZONA FRESH\Desktop\Caja Fresh\abrir_caja.bat"
$Shortcut.WorkingDirectory = "C:\Users\ZONA FRESH\Desktop\Caja Fresh"
$Shortcut.IconLocation = "C:\Users\ZONA FRESH\Desktop\Caja Fresh\icon.ico"
$Shortcut.Description = "Lanzador Oficial del Sistema Caja Fresh POS"
$Shortcut.Save()
