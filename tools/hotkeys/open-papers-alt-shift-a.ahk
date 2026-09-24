#Requires AutoHotkey v2.0
#SingleInstance Force
#UseHook

; Alt+Shift+A should work even when Papers is not running. If it is already
; open, activate its main window without creating another visible window.
!+a:: {
    for hwnd in WinGetList("ahk_exe Papers.exe") {
        if !WinGetTitle(hwnd)
            continue
        try WinRestore(hwnd)
        WinActivate(hwnd)
        return
    }

    ; Use the creator's normal Desktop shortcut when Papers is not running.
    Run("C:\Users\admin\Desktop\Papers.lnk")
}
