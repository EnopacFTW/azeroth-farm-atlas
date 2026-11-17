; FarmForever NSIS installer hooks.
; Up to 0.4.x the app was called "Azeroth Farm Atlas" and installed to %LOCALAPPDATA%\Azeroth Farm Atlas.
; The new installer removes that old program folder and moves its shortcuts to FarmForever.
; User data lives in %APPDATA%\de.azerothfarmatlas.desktop (same bundle identifier) and is never touched here.

Var FFMigrated

!macro NSIS_HOOK_PREINSTALL
  StrCpy $FFMigrated 0
  IfFileExists "$LOCALAPPDATA\Azeroth Farm Atlas\uninstall.exe" 0 ff_no_old_install
    StrCpy $FFMigrated 1
    ; /UPDATE keeps shortcuts and app data in the old uninstaller; _?= runs it in place so ExecWait really waits
    ExecWait '"$LOCALAPPDATA\Azeroth Farm Atlas\uninstall.exe" /S /UPDATE _?=$LOCALAPPDATA\Azeroth Farm Atlas'
    Delete "$LOCALAPPDATA\Azeroth Farm Atlas\uninstall.exe"
    RMDir /r "$LOCALAPPDATA\Azeroth Farm Atlas"
  ff_no_old_install:
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ${If} $FFMigrated = 1
    ; replace the old shortcuts (they pointed into the removed folder)
    IfFileExists "$DESKTOP\Azeroth Farm Atlas.lnk" 0 ff_no_desktop
      Delete "$DESKTOP\Azeroth Farm Atlas.lnk"
      CreateShortcut "$DESKTOP\FarmForever.lnk" "$INSTDIR\FarmForever.exe"
    ff_no_desktop:
    Delete "$SMPROGRAMS\Azeroth Farm Atlas.lnk"
    CreateShortcut "$SMPROGRAMS\FarmForever.lnk" "$INSTDIR\FarmForever.exe"
  ${EndIf}
!macroend
