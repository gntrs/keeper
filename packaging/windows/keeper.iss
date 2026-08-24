; ---------------------------------------------------------------------
;  The windows installer, compiled by inno setup 6.
;
;    iscc packaging\windows\keeper.iss /DAppVersion=0.2.0 /DStage=<folder>
;
;  Stage is the folder that packaging/build-windows.mjs produced, the one
;  holding keeper.cmd and node and app. This script only wraps it: it adds a
;  start menu entry with keeper's icon, an uninstaller, and an install into
;  the user's own profile rather than program files.
;
;  PER USER ON PURPOSE. Installing into program files needs an administrator,
;  and asking a photographer to find an IT person to look at their own
;  photographs is the end of the story. It also means the uninstall is
;  complete: everything is in one folder under the user, and nothing is
;  written to the registry that outlives it.
;
;  NOT SIGNED. Windows will show a smartscreen warning on first run and say
;  the publisher is unknown, because it is. That is written in the readme
;  rather than hidden, and this script grows a SignTool line the day there is
;  a certificate to sign with.
; ---------------------------------------------------------------------

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef Stage
  #define Stage "..\out\stage\keeper"
#endif

[Setup]
AppId={{7B0F1E2A-4C55-4E8B-9E0A-6D2C4F1A9C31}
AppName=keeper
AppVersion={#AppVersion}
AppPublisher=keeper
AppPublisherURL=https://github.com/gntrs/keeper
DefaultDirName={localappdata}\Programs\keeper
; the program goes under Programs and keeper's own two state files stay in
; {localappdata}\keeper beside it, so an uninstall can remove all of one
; without reaching into the other by accident
DefaultGroupName=keeper
DisableProgramGroupPage=yes
DisableDirPage=yes
PrivilegesRequired=lowest
OutputDir=..\out
OutputBaseFilename=keeper-{#AppVersion}-windows-x64-setup
SetupIconFile={#Stage}\keeper.ico
UninstallDisplayIcon={app}\keeper.ico
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; the licence has to be agreed to before anything is written, which is also
; the only screen in this installer worth reading
LicenseFile={#Stage}\LICENSE
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Files]
Source: "{#Stage}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
; Minimised, because the console window is only there to be closed when you
; are done. The browser is where keeper actually is, and it takes the focus
; a second later anyway.
Name: "{group}\keeper"; Filename: "{app}\keeper.cmd"; IconFilename: "{app}\keeper.ico"; WorkingDir: "{app}"; Flags: runminimized
Name: "{group}\keeper doctor"; Filename: "{app}\doctor.cmd"; IconFilename: "{app}\keeper.ico"; WorkingDir: "{app}"
Name: "{userdesktop}\keeper"; Filename: "{app}\keeper.cmd"; IconFilename: "{app}\keeper.ico"; WorkingDir: "{app}"; Flags: runminimized; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "put keeper on the desktop"; GroupDescription: "shortcuts"

[Run]
Filename: "{app}\keeper.cmd"; Description: "start keeper"; Flags: postinstall nowait shellexec runminimized

[UninstallDelete]
; The index, the thumbnails and the tags live next to the photographs and are
; never touched by an uninstall. What is removed here is only the two files
; keeper wrote about itself: which archive was open, and which port it was on.
Type: filesandordirs; Name: "{localappdata}\keeper\start"
Type: files; Name: "{localappdata}\keeper\run.json"
Type: files; Name: "{localappdata}\keeper\seat.json"
