If WScript.Arguments.Count <> 2 Then
  WScript.Echo "Usage: run_brc_edu_sync_hidden.vbs <xlsx-path> <https-sync-endpoint>"
  WScript.Quit 1
End If
Set files = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
scriptPath = files.BuildPath(files.GetParentFolderName(WScript.ScriptFullName), "sync_brc_edu_to_staging_slot.ps1")
For Each arg In WScript.Arguments
  If InStr(arg, Chr(34)) > 0 Then WScript.Quit 1
Next
shell.Run "powershell.exe -NoProfile -File " & Chr(34) & scriptPath & Chr(34) & " -InputPath " & Chr(34) & WScript.Arguments(0) & Chr(34) & " -Endpoint " & Chr(34) & WScript.Arguments(1) & Chr(34), 0, True
