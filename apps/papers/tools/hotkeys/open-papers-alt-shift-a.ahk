#Requires AutoHotkey v2.0
#SingleInstance Force
#UseHook

; The Papers main native window is an unowned top-level window titled Papers.
; Try each such window in z-order, and only claim success after verifying that
; the exact HWND is visible, restored, and owns the foreground.
TryActivatePapersWindow(hwnd) {
    try {
        winTitle := "ahk_id " hwnd
        if !DllCall("IsWindow", "Ptr", hwnd, "Int")
            return false

        if (WinGetMinMax(winTitle) = -1)
            WinRestore(winTitle)

        startedAt := A_TickCount
        while (A_TickCount - startedAt < 1000) {
            if !DllCall("IsWindow", "Ptr", hwnd, "Int")
                return false
            if (WinGetMinMax(winTitle) != -1 && DllCall("IsWindowVisible", "Ptr", hwnd, "Int"))
                break
            Sleep(25)
        }
        if (WinGetMinMax(winTitle) = -1 || !DllCall("IsWindowVisible", "Ptr", hwnd, "Int"))
            return false

        WinActivate(winTitle)
        startedAt := A_TickCount
        while (A_TickCount - startedAt < 1250) {
            if !DllCall("IsWindow", "Ptr", hwnd, "Int")
                return false
            if (DllCall("GetForegroundWindow", "Ptr") = hwnd)
                return DllCall("IsWindowVisible", "Ptr", hwnd, "Int") && WinGetMinMax(winTitle) != -1
            Sleep(25)
        }
    } catch {
        return false
    }
    return false
}

TryActivateMainPapersWindow() {
    try {
        windows := WinGetList("ahk_exe Papers.exe")
    } catch {
        return false
    }

    for hwnd in windows {
        try {
            winTitle := "ahk_id " hwnd
            if (WinGetTitle(winTitle) != "Papers")
                continue
            ; Skip owned dialogs and auxiliary windows; Papers' BaseWindow is
            ; the unowned top-level window.
            if DllCall("GetWindow", "Ptr", hwnd, "UInt", 4, "Ptr")
                continue
        } catch {
            continue
        }

        if TryActivatePapersWindow(hwnd)
            return true
    }
    return false
}

; If no main window can be verified as restored and active, use Papers' normal
; shortcut path. Its existing single-instance handoff verifies activation and
; has a bounded fallback for Windows foreground-lock refusals.
!+a:: {
    if TryActivateMainPapersWindow()
        return

    ; Use the creator's normal Desktop shortcut when Papers is not running or
    ; direct activation of its existing main window failed.
    Run("C:\Users\admin\Desktop\Papers.lnk")
}
