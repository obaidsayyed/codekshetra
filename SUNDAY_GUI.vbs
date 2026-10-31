Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Users\omban\.gemini\antigravity\scratch\SUNDAY"
WshShell.Run """.\.venv\Scripts\pythonw.exe"" -m app.main", 0, False
Set WshShell = Nothing

