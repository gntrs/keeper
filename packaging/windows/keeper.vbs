' ---------------------------------------------------------------------
'  Starts keeper with no window at all.
'
'  KEEPER IS A SERVER AND A BROWSER TAB, SO IT HAS NO WINDOW OF ITS OWN.
'  The console that keeper.cmd opens was standing in for one: somewhere to
'  read the address off, and something to close when you were done. Neither
'  job is still open. The browser opens itself and the page has a quit
'  button on it, so all the console did was sit in the taskbar looking like
'  the app had left something running, which is exactly what it looked like
'  to the person who asked for it to go.
'
'  Run 0 is a hidden window. False means do not wait for it, so this script
'  is gone a millisecond later and nothing is left holding the process.
'
'  keeper.cmd is still there and still opens visibly when you double click
'  it, which is the whole portable folder's way in and the way to drag a
'  folder straight onto keeper. This is only what the shortcuts point at.
' ---------------------------------------------------------------------

Dim sh, fso, here
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)

sh.Run """" & here & "\keeper.cmd"" --quiet", 0, False
