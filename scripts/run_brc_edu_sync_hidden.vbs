Set shell = CreateObject("WScript.Shell")
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File ""C:\Users\Lauren.Dwyer\source\repos\mcp_v2\s2t2\brc-company-mcp-server\scripts\sync_brc_edu_to_staging_slot.ps1""", 0, True
