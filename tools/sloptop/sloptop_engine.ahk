#Requires AutoHotkey v2.0
#SingleInstance Force

; Auto-elevate to Administrator to control elevated windows (e.g., scrcpy launched via WMI automation)
if !A_IsAdmin {
    traceArgument := A_Args.Length >= 1 ? A_Args[1] : ""
    traceTokenArgument := A_Args.Length >= 2 ? A_Args[2] : ""
    diagnosticArgument := A_Args.Length >= 3 ? A_Args[3] : ""
    try {
        Run('*RunAs "' A_AhkPath '" "' A_ScriptFullPath '" "' traceArgument '" "' traceTokenArgument '" "' diagnosticArgument '"')
        ExitApp()
    } catch {
        MsgBox("This script requires Administrator privileges to control elevated windows like scrcpy.", "Elevation Required", 48)
        ExitApp()
    }
}

WriteStartupReceipt(path, token) {
    processId := DllCall("GetCurrentProcessId", "UInt")
    tempPath := path ".startup-tmp-" processId
    admin := A_IsAdmin ? "true" : "false"
    escapedPath := StrReplace(path, "\", "\\")
    payload := '{"kind":"startup","token":"' token '","pid":' processId ',"timestamp":"' A_NowUTC '","admin":' admin ',"argCount":' A_Args.Length ',"argPath":"' escapedPath '"}`n'
    try {
        if FileExist(tempPath)
            FileDelete(tempPath)
        file := FileOpen(tempPath, "w", "UTF-8-RAW")
        file.Write(payload)
        file.Close()
        FileMove(tempPath, path, true)
        return true
    } catch {
        try FileDelete(tempPath)
        return false
    }
}

if A_Args.Length >= 3 && A_Args[3] = "startup-diagnostic" {
    diagnosticPath := A_Args[1]
    diagnosticToken := A_Args[2]
    WriteStartupReceipt(diagnosticPath, diagnosticToken)
    ExitApp()
}

A_MaxHotkeysPerInterval := 999999
DllCall("SetProcessDpiAwarenessContext", "ptr", -4, "ptr")
CoordMode("Mouse", "Screen")

; ============================================================
; UNIFIED SLOPTOP WINDOW CONTROL ENGINE
; Auto-detects main machine vs MWB-controlled secondary machine.
; Single script replaces both "ctrl clip close SLOPTOP.ahk"
; and "2NDctrlclipclose SLOPTOP.ahk".
; ============================================================

global savedPos := Map()
global rButtonDragging := false
global movingWindowHwnd := 0
global movingRightDownAt := 0
global movingWindows := Map()
global movingMode := ""
global movingStartedWithShift := false
global movingResizeReferenceHeight := 1
global moveSelected := Map()
global mButtonDragging := false
global spacePressed := false
global ctrlSpaceActivationDown := false
global ctrlSpaceArmed := false
global ctrlSpaceLatched := false
global ctrlSpaceHoldPending := false
global ctrlSpaceKeyWatcher := 0
if (EnvGet("SLOPTOP_PICKER_ISOLATED") != "1")
    CloseConflictingScripts()
OnExit(HandleScriptExit)
ShowStartupNotification()

; ============================================================
; CUSTOM CURSORS — portable paths relative to script directory
; ============================================================

global moveCursorPath   := A_ScriptDir "\assets\cursor\move.cur"
global squashCursorPath := A_ScriptDir "\assets\cursor\squash.cur"
global voreCursorPath   := A_ScriptDir "\assets\cursor\vore.cur"
global currentCursorType := ""
global activeTargetHwnd := 0
global pickerActive := false
; Safety gate remains closed until this local-only picker passes its isolated
; static/harness checks. The mode contains no hover/click network round trips.
global pickerIntegrationEnabled := true
global pickerToken := ""
global pickerPurpleGui := 0
global pickerRedGui := 0
global pickerSelected := Map()
global pickerLastHoverHwnd := 0
global pickerHoverVisualKey := ""
global pickerActivationPath := "C:\Users\Public\Documents\PapersNativeBridgeReceipts\picker-activate.signal"
global pickerAckPath := "C:\Users\Public\Documents\PapersNativeBridgeReceipts\picker-ack.signal"
global pickerResultPath := "C:\Users\Public\Documents\PapersNativeBridgeReceipts\picker-result.signal"
global pickerCancelPath := "C:\Users\Public\Documents\PapersNativeBridgeReceipts\picker-cancel.signal"
global pickerLastActivationCheckAt := 0
global pickerLastCancelCheckAt := 0
global pickerTracePath := A_Args.Length >= 1 ? A_Args[1] : EnvGet("SLOPTOP_PICKER_TRACE")
global pickerTraceToken := A_Args.Length >= 2 ? A_Args[2] : EnvGet("SLOPTOP_PICKER_TRACE_TOKEN")
global pickerTraceLines := []

PickerTrace(message) {
    global pickerTracePath, pickerTraceToken, pickerTraceLines
    if (pickerTracePath = "")
        return
    try {
        processId := DllCall("GetCurrentProcessId", "UInt")
        pickerTraceLines.Push(Format("{1} token={2} pid={3} {4}", A_NowUTC, pickerTraceToken, processId, message))
        tempPath := pickerTracePath ".tmp-" processId
        if FileExist(tempPath)
            FileDelete(tempPath)
        FileAppend(Join("`n", pickerTraceLines) "`n", tempPath, "UTF-8-RAW")
        FileMove(tempPath, pickerTracePath, true)
    }
}

Join(separator, values) {
    result := ""
    for index, value in values
        result .= (index > 1 ? separator : "") value
    return result
}

PickerJsonValue(text, key) {
    if RegExMatch(text, '"' key '"\s*:\s*(?:"([^"]*)"|(\d+)|(true|false))', &m)
        return m[1] != "" ? m[1] : (m[2] != "" ? m[2] : m[3])
    return ""
}

PickerTrace("startup script=" A_ScriptFullPath)

PickerAtomicWrite(path, body) {
    try {
        tempPath := path ".tmp-" DllCall("GetCurrentProcessId", "UInt")
        if FileExist(tempPath)
            FileDelete(tempPath)
        ; Node's JSON.parse does not strip a UTF-8 BOM. Protocol signals must
        ; therefore be raw UTF-8, not AutoHotkey's BOM-prefixed "UTF-8".
        FileAppend(body, tempPath, "UTF-8-RAW")
        if FileExist(path)
            FileDelete(path)
        FileMove(tempPath, path, true)
        return true
    }
    return false
}

PickerActivationSeeds(payload) {
    seeds := []
    pos := 1
    pattern := '"processId"\s*:\s*(\d+)\s*,\s*"x"\s*:\s*(-?\d+)\s*,\s*"y"\s*:\s*(-?\d+)\s*,\s*"width"\s*:\s*(\d+)\s*,\s*"height"\s*:\s*(\d+)'
    while RegExMatch(payload, pattern, &match, pos) {
        seeds.Push({pid: match[1] + 0, x: match[2] + 0, y: match[3] + 0, w: match[4] + 0, h: match[5] + 0})
        pos := match.Pos + match.Len
    }
    return seeds
}

HidePickerOverlays() {
    global pickerPurpleGui, pickerRedGui, pickerSelected, pickerHoverVisualKey
    pickerPurpleGui.Hide()
    pickerRedGui.Hide()
    for hwnd, entry in pickerSelected
        HideBorder(entry.border)
    pickerHoverVisualKey := ""
}

FindPickerSeedWindow(seed) {
    matches := []
    processMatches := []
    for hwnd in WinGetList() {
        try {
            if !DllCall("IsWindowVisible", "Ptr", hwnd, "Int") || IsOverlayWindow(hwnd) || IsSystemWindow(hwnd)
                continue
            if (WinGetPID("ahk_id " hwnd) != seed.pid)
                continue
            processMatches.Push(hwnd)
            GetPickerIdentityRect(hwnd, &x, &y, &w, &h)
            if (x = seed.x && y = seed.y && w = seed.w && h = seed.h)
                matches.Push(hwnd)
        }
    }
    ; Window bounds may legitimately change between Papers' snapshot and this
    ; 100ms signal poll. A unique window in the same process is still an
    ; unambiguous seed; multiple same-process windows remain fail-closed.
    if (matches.Length = 1)
        return matches[1]
    return processMatches.Length = 1 ? processMatches[1] : 0
}

AddPickerSelection(hwnd) {
    global pickerSelected
    try {
        pid := WinGetPID("ahk_id " hwnd)
        GetPickerIdentityRect(hwnd, &x, &y, &w, &h)
        GetVisibleRect(hwnd, &vx, &vy, &vw, &vh)
        if (pid <= 0 || w <= 0 || h <= 0)
            return false
        pickerSelected[hwnd] := {pid: pid, x: x, y: y, w: w, h: h, vx: vx, vy: vy, vw: vw, vh: vh, border: CreateBorderOverlay("46B889")}
        ShowBorderOnTarget(pickerSelected[hwnd].border, hwnd, vx, vy, vw, vh)
        return true
    }
    return false
}

RemovePickerSelection(hwnd) {
    global pickerSelected
    if !pickerSelected.Has(hwnd)
        return
    DestroyBorder(pickerSelected[hwnd].border)
    pickerSelected.Delete(hwnd)
}

ClearPickerSelections() {
    global pickerSelected
    for hwnd, entry in pickerSelected
        DestroyBorder(entry.border)
    pickerSelected := Map()
}

SeedPickerSelection(seeds) {
    ClearPickerSelections()
    for seed in seeds {
        hwnd := FindPickerSeedWindow(seed)
        ; A closed/stale or genuinely ambiguous prior member must not brick the
        ; whole picker. Leave that member unselected; Enter will then remove it
        ; unless the creator explicitly selects its live replacement.
        if !hwnd
            continue
        AddPickerSelection(hwnd)
    }
    return true
}

RefreshPickerSelections() {
    global pickerSelected
    stale := []
    for hwnd, entry in pickerSelected {
        try {
            if !DllCall("IsWindow", "Ptr", hwnd, "Int") || !DllCall("IsWindowVisible", "Ptr", hwnd, "Int") || WinGetPID("ahk_id " hwnd) != entry.pid {
                stale.Push(hwnd)
                continue
            }
            GetPickerIdentityRect(hwnd, &x, &y, &w, &h)
            GetVisibleRect(hwnd, &vx, &vy, &vw, &vh)
            if (w <= 0 || h <= 0) {
                stale.Push(hwnd)
                continue
            }
            if (x != entry.x || y != entry.y || w != entry.w || h != entry.h || vx != entry.vx || vy != entry.vy || vw != entry.vw || vh != entry.vh) {
                entry.x := x, entry.y := y, entry.w := w, entry.h := h
                entry.vx := vx, entry.vy := vy, entry.vw := vw, entry.vh := vh
                pickerSelected[hwnd] := entry
            }
            ; Reassert z-order without hiding: each border sits immediately
            ; above its own window and is naturally obscured by windows above.
            ShowBorderOnTarget(entry.border, hwnd, vx, vy, vw, vh)
        } catch {
            stale.Push(hwnd)
        }
    }
    for hwnd in stale
        RemovePickerSelection(hwnd)
}

PickerOrdinaryModeActive() {
    return IsMoveModeActive() || IsResizeModeActive() || ForceCloseModeActive()
}

UpdatePickerMode() {
    global pickerActive, pickerPurpleGui, pickerRedGui, pickerSelected, pickerLastHoverHwnd, pickerHoverVisualKey
    if !pickerActive {
        pickerLastHoverHwnd := 0
        pickerHoverVisualKey := ""
        HidePickerOverlays()
        return
    }
    CheckPickerCancel()
    if !pickerActive
        return
    RefreshPickerSelections()
    if PickerOrdinaryModeActive() {
        pickerPurpleGui.Hide()
        pickerRedGui.Hide()
        pickerHoverVisualKey := ""
        return
    }
    if IsMouseOverCSP() {
        pickerPurpleGui.Hide()
        pickerRedGui.Hide()
        pickerHoverVisualKey := ""
        return
    }
    target := GetMouseTargetInfo()
    if !target.hwnd {
        pickerLastHoverHwnd := 0
        pickerHoverVisualKey := ""
        pickerPurpleGui.Hide()
        pickerRedGui.Hide()
        return
    }
    GetVisibleRect(target.hwnd, &localX, &localY, &localW, &localH)
    if (localW <= 0 || localH <= 0) {
        pickerPurpleGui.Hide()
        pickerRedGui.Hide()
        pickerHoverVisualKey := ""
        return
    }
    selectedHover := pickerSelected.Has(target.hwnd)
    visualKey := target.hwnd "|" localX "|" localY "|" localW "|" localH "|" selectedHover
    if (visualKey = pickerHoverVisualKey)
        return
    pickerHoverVisualKey := visualKey
    if selectedHover {
        pickerPurpleGui.Hide()
        ShowTint(pickerRedGui, localX, localY, localW, localH, "D45A63", 48)
    } else {
        pickerRedGui.Hide()
        ShowTint(pickerPurpleGui, localX, localY, localW, localH, "8D5CC7", 56)
    }
    pickerLastHoverHwnd := target.hwnd
}

PickerWriteAck() {
    global pickerAckPath, pickerToken
    return PickerAtomicWrite(pickerAckPath, '{"version":2,"token":"' pickerToken '","active":true}')
}

PickerCommitBody(token, selected) {
    windows := ""
    for index, entry in selected {
        windows .= (index > 1 ? "," : "") '{"processId":' entry.pid ',"x":' entry.x ',"y":' entry.y ',"width":' entry.w ',"height":' entry.h '}'
    }
    return '{"version":2,"token":"' token '","outcome":"committed","windows":[' windows ']}'
}

PickerSnapshot() {
    global pickerSelected
    snapshot := []
    RefreshPickerSelections()
    for hwnd, entry in pickerSelected
        snapshot.Push({pid: entry.pid, x: entry.x, y: entry.y, w: entry.w, h: entry.h})
    return snapshot
}

CheckPickerCancel() {
    global pickerActive, pickerCancelPath, pickerToken, pickerLastCancelCheckAt
    if !pickerActive
        return
    now := A_TickCount
    if (now - pickerLastCancelCheckAt < 100)
        return
    pickerLastCancelCheckAt := now
    if !FileExist(pickerCancelPath)
        return
    payload := ""
    try payload := FileRead(pickerCancelPath, "UTF-8")
    try FileDelete(pickerCancelPath)
    if (PickerJsonValue(payload, "version") = "2" && PickerJsonValue(payload, "token") = pickerToken)
        StopPickerMode(false)
}

CheckPickerActivation() {
    global pickerActive, pickerActivationPath, pickerToken, pickerLastActivationCheckAt, pickerIntegrationEnabled
    if !pickerIntegrationEnabled {
        pickerActive := false
        if FileExist(pickerActivationPath)
            try FileDelete(pickerActivationPath)
        return
    }
    if pickerActive
        return
    now := A_TickCount
    if (now - pickerLastActivationCheckAt < 100)
        return
    pickerLastActivationCheckAt := now
    if !FileExist(pickerActivationPath)
        return
    payload := ""
    try payload := FileRead(pickerActivationPath, "UTF-8")
    catch
        return
    if (PickerJsonValue(payload, "version") != "2") {
        try FileDelete(pickerActivationPath)
        return
    }
    nextToken := PickerJsonValue(payload, "token")
    if (nextToken = "") {
        try FileDelete(pickerActivationPath)
        return
    }
    PickerTrace("activation signal received")
    HideOverlays()
    pickerToken := nextToken
    if !SeedPickerSelection(PickerActivationSeeds(payload)) {
        pickerToken := ""
        try FileDelete(pickerActivationPath)
        PickerTrace("activation rejected: seed mismatch")
        return
    }
    pickerActive := true
    try FileDelete(pickerActivationPath)
    if !PickerWriteAck() {
        StopPickerMode(false)
        return
    }
    PickerTrace("activation accepted")
}

StopPickerMode(cancel := true) {
    global pickerActive, pickerToken, pickerResultPath, pickerSelected, pickerLastHoverHwnd, pickerHoverVisualKey
    wasActive := pickerActive
    stoppedToken := pickerToken
    pickerActive := false
    pickerToken := ""
    pickerLastHoverHwnd := 0
    pickerHoverVisualKey := ""
    HidePickerOverlays()
    ClearPickerSelections()
    if (wasActive && cancel)
        PickerAtomicWrite(pickerResultPath, '{"version":2,"token":"' stoppedToken '","outcome":"cancelled"}')
}

SetGlobalCursor(path, type := "") {
    global currentCursorType
    if (currentCursorType = type)
        return
    currentCursorType := type
    hCursor := DllCall("LoadCursorFromFile", "Str", path, "Ptr")
    if hCursor
        DllCall("SetSystemCursor", "Ptr", hCursor, "UInt", 32512)
}

ResetCursors() {
    global currentCursorType
    if (currentCursorType = "")
        return
    currentCursorType := ""
    DllCall("SystemParametersInfo", "UInt", 0x57, "UInt", 0, "Ptr", 0, "UInt", 0)
}

HandleScriptExit(*) {
    global ctrlSpaceKeyWatcher
    SetTimer(UpdateMovingWindow, 0)
    SetTimer(ConfirmHeldCtrlSpace, 0)
    try ClearMoveSelections()
    if ctrlSpaceKeyWatcher
        ctrlSpaceKeyWatcher.Stop()
    try HideOverlays()
    try ResetCursors()
}

; Kill any orphaned SlopTop / ctrl_space AHK instances on startup
CloseConflictingScripts() {
    prevDetectHidden := DetectHiddenWindows(true)
    pattern := "i)(?:sloptop|ctrl.{0,20}clip.{0,20}close|ctrl[ _]space)"
    try {
        for hwnd in WinGetList("ahk_class AutoHotkey") {
            if (hwnd = A_ScriptHwnd)
                continue
            try title := WinGetTitle(hwnd)
            catch
                continue
            if !RegExMatch(title, pattern)
                continue
            try WinClose(hwnd)
            Sleep(300)
            if WinExist("ahk_id " hwnd) {
                try pid := WinGetPID(hwnd)
                catch
                    continue
                try ProcessClose(pid)
            }
        }
    } finally {
        DetectHiddenWindows(prevDetectHidden)
    }
}

ShowStartupNotification() {
    global notifyGui
    notifyGui := Gui("+AlwaysOnTop -Caption -Border +ToolWindow +Owner")
    notifyGui.BackColor := "11111B" ; Sleek dark background

    ; Add a subtle glowing sidebar
    notifyGui.Add("Progress", "x0 y0 w4 h60 Background3388FF", 100)

    notifyGui.SetFont("s10 bold c3388FF", "Segoe UI")
    notifyGui.Add("Text", "x15 y12 w230", "SLOPTOP ACTIVE")
    notifyGui.SetFont("s8 c888888 norm", "Segoe UI")
    notifyGui.Add("Text", "x15 y30 w230", "Adaptive Window Manager is running")

    ; Get position above system tray
    MonitorGetWorkArea(MonitorGetPrimary(), &l, &t, &r, &b)
    nx := r - 260 - 20
    ny := b - 60 - 20

    ; Set transparency to 0 initially and show
    WinSetTransparent(0, notifyGui)
    notifyGui.Show("x" nx " y" ny " w260 h60 NA")

    ; Smooth fade in
    Loop 15 {
        WinSetTransparent(A_Index * 17, notifyGui)
        Sleep(10)
    }

    ; Stay for 1.5s
    SetTimer(FadeOutNotification, -1500)
}

FadeOutNotification() {
    global notifyGui
    try {
        Loop 15 {
            WinSetTransparent(255 - (A_Index * 17), notifyGui)
            Sleep(10)
        }
        notifyGui.Destroy()
    }
}

; ============================================================
; PAINT APP DETECTION (CLIP STUDIO PAINT / KRITA)
; ============================================================

global PaintAppProcs := Map("CLIPStudioPaint.exe", true, "krita.exe", true)
global PaintAppCache := Map()   ; hWnd -> bool, cleared when it grows large

IsWindowCSP(hWnd) {
    global PaintAppProcs, PaintAppCache
    if !hWnd
        return false
    if PaintAppCache.Has(hWnd)
        return PaintAppCache[hWnd]
    result := false
    try result := PaintAppProcs.Has(WinGetProcessName("ahk_id " hWnd))
    if PaintAppCache.Count > 512
        PaintAppCache.Clear()   ; bound memory; stale HWNDs get re-queried
    PaintAppCache[hWnd] := result
    return result
}

IsMouseOverCSP() {
    static lastWin := 0, lastResult := false
    MouseGetPos(, , &hoverWin)
    if (hoverWin = lastWin)
        return lastResult
    lastWin := hoverWin
    if IsWindowCSP(hoverWin)
        return lastResult := true
    rootHwnd := DllCall("GetAncestor", "Ptr", hoverWin, "UInt", 2, "Ptr") ; GA_ROOT
    if rootHwnd && rootHwnd != hoverWin && IsWindowCSP(rootHwnd)
        return lastResult := true
    return lastResult := false
}

; ============================================================
; DWM / DPI NEUTRAL TRUE VISIBLE RECT
; ============================================================

; Picker protocol identities deliberately use the untrimmed Win32 rectangle.
; Papers' trusted window helper reports GetWindowRect coordinates, so using the
; same primitive here prevents a valid seed from being rejected merely because
; the visual overlay trims the DWM shadow border.
GetPickerIdentityRect(hWnd, &rx, &ry, &rw, &rh) {
    rect := Buffer(16, 0)
    if !DllCall("GetWindowRect", "Ptr", hWnd, "Ptr", rect, "Int") {
        rx := 0, ry := 0, rw := 0, rh := 0
        return false
    }
    rx := NumGet(rect, 0, "Int")
    ry := NumGet(rect, 4, "Int")
    rw := NumGet(rect, 8, "Int") - rx
    rh := NumGet(rect, 12, "Int") - ry
    return true
}

GetVisibleRect(hWnd, &rx, &ry, &rw, &rh) {
    rect := Buffer(16, 0)
    DllCall("GetWindowRect", "Ptr", hWnd, "Ptr", rect)
    x1 := NumGet(rect, 0, "Int")
    y1 := NumGet(rect, 4, "Int")
    x2 := NumGet(rect, 8, "Int")
    y2 := NumGet(rect, 12, "Int")
    windowDpi := DllCall("User32\GetDpiForWindow", "Ptr", hWnd, "UInt")
    if (!windowDpi)
        windowDpi := 96
    shadowBorder := Round(7 * (windowDpi / 96))
    rx := x1 + shadowBorder
    ry := y1
    rw := (x2 - x1) - (shadowBorder * 2)
    rh := (y2 - y1) - shadowBorder
}

; ============================================================
; UNIFIED KEY STATE ENGINE
; ============================================================
; Returns true if a key is held — works for both physical
; (main machine) and logical (MWB-injected secondary machine).

GetEngineKeyState(keyName) {
    if (keyName = "Space") {
        global spacePressed
        return spacePressed
    }
    return GetKeyState(keyName, "P") || GetKeyState(keyName)
}

; Detects if the current session is being driven by physical
; input (main machine). Used to decide whether to grab focus
; via WinActivate/SetForegroundWindow.
IsPhysicalInput() {
    return GetKeyState("Ctrl", "P")
}

IsMoveModeActive() {
    global ctrlSpaceLatched
    return (ctrlSpaceLatched || (GetEngineKeyState("Ctrl") && GetEngineKeyState("Space")))
        && !GetEngineKeyState("Shift")
}

IsResizeModeActive() {
    global ctrlSpaceLatched
    return (ctrlSpaceLatched || (GetEngineKeyState("Ctrl") && GetEngineKeyState("Space")))
        && GetEngineKeyState("Shift")
}

ForceCloseModeActive() {
    return GetEngineKeyState("Ctrl")
        && GetEngineKeyState("Shift")
        && GetEngineKeyState("Alt")
}

; ============================================================
; GDI OVERLAYS — self-contained, no external compositor needed
; ============================================================

global overlayGuis  := []
global overlayHwnds := Map()
global overlayRects := Map()

SetThreadPerMonitorV2() {
    return DllCall("SetThreadDpiAwarenessContext", "ptr", -4, "ptr")
}

RestoreThreadDpiContext(prevContext) {
    if prevContext
        DllCall("SetThreadDpiAwarenessContext", "ptr", prevContext, "ptr")
}

CreateOverlayGui(backColor := "000000", transColor := "") {
    global overlayGuis, overlayHwnds, overlayRects
    overlayGui := Gui("+AlwaysOnTop -Caption -Border +ToolWindow +E0x08000000")
    overlayGui.Opt("-DPIScale")
    overlayGui.MarginX := 0
    overlayGui.MarginY := 0
    overlayGui.BackColor := backColor
    overlayGui.Show("NA x0 y0 w1 h1")
    if (transColor != "")
        WinSetTransColor(transColor, overlayGui)
    overlayGui.Hide()
    overlayGuis.Push(overlayGui)
    overlayHwnds[overlayGui.Hwnd] := true
    overlayRects[overlayGui.Hwnd] := {x: 0, y: 0, w: 1, h: 1}
    return overlayGui
}

; Picker surfaces are click-through as well as non-activating. They are kept
; out of overlayGuis so ordinary Ctrl/Space cleanup cannot hide/re-show them
; every frame; picker teardown owns them explicitly.
CreatePickerOverlayGui(backColor := "000000", topmost := true) {
    global overlayHwnds, overlayRects
    options := (topmost ? "+AlwaysOnTop " : "") "-Caption -Border +ToolWindow +E0x08000020"
    overlayGui := Gui(options)
    overlayGui.Opt("-DPIScale")
    overlayGui.MarginX := 0
    overlayGui.MarginY := 0
    overlayGui.BackColor := backColor
    overlayGui.Show("NA x0 y0 w1 h1")
    overlayGui.Hide()
    overlayHwnds[overlayGui.Hwnd] := true
    overlayRects[overlayGui.Hwnd] := {x: 0, y: 0, w: 1, h: 1}
    return overlayGui
}

PositionOverlay(gui, x, y, w, h) {
    global overlayRects
    ; Clip every overlay to the real virtual desktop. This prevents stale or
    ; malformed geometry from creating the screen-sized translucent slab seen
    ; in the eye test while still supporting windows spanning monitors.
    vx := SysGet(76), vy := SysGet(77), vw := SysGet(78), vh := SysGet(79)
    right := Min(x + w, vx + vw)
    bottom := Min(y + h, vy + vh)
    x := Max(x, vx)
    y := Max(y, vy)
    w := right - x
    h := bottom - y
    if (w <= 0 || h <= 0 || w > vw || h > vh) {
        overlayRects[gui.Hwnd] := {x: x, y: y, w: w, h: h}
        gui.Hide()
        return false
    }
    overlayRects[gui.Hwnd] := {x: x, y: y, w: w, h: h}
    DllCall("SetWindowPos",
        "Ptr",  gui.Hwnd,
        "Ptr",  -1,
        "Int",  x,
        "Int",  y,
        "Int",  w,
        "Int",  h,
        "UInt", 0x0010 | 0x0040)
    return true
}

ShowTint(gui, x, y, w, h, color, alpha) {
    gui.BackColor := color
    if PositionOverlay(gui, x, y, w, h)
        WinSetTransparent(alpha, gui)
}

PositionPickerBorder(gui, targetHwnd, x, y, w, h) {
    global overlayRects
    vx := SysGet(76), vy := SysGet(77), vw := SysGet(78), vh := SysGet(79)
    right := Min(x + w, vx + vw), bottom := Min(y + h, vy + vh)
    x := Max(x, vx), y := Max(y, vy), w := right - x, h := bottom - y
    if (w <= 0 || h <= 0 || w > vw || h > vh || !DllCall("IsWindow", "Ptr", targetHwnd, "Int")) {
        gui.Hide()
        return false
    }
    overlayRects[gui.Hwnd] := {x: x, y: y, w: w, h: h}
    ; GW_HWNDPREV is the window immediately above the target. Inserting after
    ; it places this outline between that window and the target: visible on its
    ; own window, naturally obstructed by every foreground window.
    above := DllCall("GetWindow", "Ptr", targetHwnd, "UInt", 3, "Ptr")
    ; Once the overlay is immediately above its target, GW_HWNDPREV returns
    ; the overlay itself. Passing that handle as hWndInsertAfter prevents the
    ; position update, leaving a blue ghost at an earlier location.
    alreadyAdjacent := (above = gui.Hwnd)
    insertAfter := alreadyAdjacent ? 0 : (above ? above : 0)
    flags := 0x0010 | 0x0040 | (alreadyAdjacent ? 0x0004 : 0)
    DllCall("SetWindowPos", "Ptr", gui.Hwnd, "Ptr", insertAfter,
        "Int", x, "Int", y, "Int", w, "Int", h, "UInt", flags)
    return true
}

CreateBorderOverlay(color) {
    return {
        top: CreatePickerOverlayGui(color, false),
        bottom: CreatePickerOverlayGui(color, false),
        left: CreatePickerOverlayGui(color, false),
        right: CreatePickerOverlayGui(color, false)
    }
}

HideBorder(border) {
    ; Timer/hotkey threads can overlap at a mode transition. A stale timer may
    ; reach cleanup after Enter already destroyed the same four GUIs.
    try border.top.Hide()
    try border.bottom.Hide()
    try border.left.Hide()
    try border.right.Hide()
}

DestroyBorder(border) {
    global overlayHwnds, overlayRects
    for gui in [border.top, border.bottom, border.left, border.right] {
        try {
            hwnd := gui.Hwnd
            overlayHwnds.Delete(hwnd)
            overlayRects.Delete(hwnd)
            gui.Destroy()
        }
    }
}

ShowBorderOnTarget(border, targetHwnd, x, y, w, h) {
    thickness := Max(2, Min(4, Round(Min(w, h) / 120)))
    try PositionPickerBorder(border.top, targetHwnd, x, y, w, thickness)
    try PositionPickerBorder(border.bottom, targetHwnd, x, y + h - thickness, w, thickness)
    try PositionPickerBorder(border.left, targetHwnd, x, y + thickness, thickness, Max(1, h - (2 * thickness)))
    try PositionPickerBorder(border.right, targetHwnd, x + w - thickness, y + thickness, thickness, Max(1, h - (2 * thickness)))
    try WinSetTransparent(205, border.top)
    try WinSetTransparent(205, border.bottom)
    try WinSetTransparent(205, border.left)
    try WinSetTransparent(205, border.right)
}

ToggleMoveSelection(hwnd) {
    global moveSelected, overlayHwnds, overlayRects
    if moveSelected.Has(hwnd) {
        gui := moveSelected[hwnd].tint
        overlayHwnds.Delete(gui.Hwnd)
        overlayRects.Delete(gui.Hwnd)
        gui.Destroy()
        moveSelected.Delete(hwnd)
        return
    }
    try {
        pid := WinGetPID("ahk_id " hwnd)
        GetVisibleRect(hwnd, &x, &y, &w, &h)
        if (pid <= 0 || w <= 0 || h <= 0)
            return
        tint := CreatePickerOverlayGui("3388FF", false)
        moveSelected[hwnd] := {pid: pid, tint: tint}
        PositionPickerBorder(tint, hwnd, x, y, w, h)
        WinSetTransparent(70, tint)
    }
}

ClearMoveSelections() {
    global moveSelected, overlayHwnds, overlayRects
    for hwnd, entry in moveSelected {
        try {
            overlayHwnds.Delete(entry.tint.Hwnd)
            overlayRects.Delete(entry.tint.Hwnd)
            entry.tint.Destroy()
        }
    }
    moveSelected := Map()
}

RefreshMoveSelections() {
    global moveSelected, movingWindowHwnd, movingWindows, overlayHwnds, overlayRects
    stale := []
    for hwnd, entry in moveSelected {
        try {
            if !DllCall("IsWindow", "Ptr", hwnd, "Int") || !DllCall("IsWindowVisible", "Ptr", hwnd, "Int") || WinGetPID("ahk_id " hwnd) != entry.pid {
                stale.Push(hwnd)
                continue
            }
            GetVisibleRect(hwnd, &x, &y, &w, &h)
            if (w <= 0 || h <= 0) {
                stale.Push(hwnd)
                continue
            }
            ; The move timer positions this tint from the same mouse delta as
            ; its window. A DWM rect can lag behind and pull it back briefly.
            if movingWindowHwnd && movingWindows.Has(hwnd)
                continue
            PositionPickerBorder(entry.tint, hwnd, x, y, w, h)
        } catch {
            stale.Push(hwnd)
        }
    }
    for hwnd in stale {
        entry := moveSelected[hwnd]
        try {
            overlayHwnds.Delete(entry.tint.Hwnd)
            overlayRects.Delete(entry.tint.Hwnd)
            entry.tint.Destroy()
        }
        moveSelected.Delete(hwnd)
    }
}

GetInnerZone(wx, wy, ww, wh, &ix, &iy, &iw, &ih) {
    iw := Max(1, Floor(ww * 0.50))
    ih := Max(1, Floor(wh * 0.50))
    ix := wx + Floor((ww - iw) / 2)
    iy := wy + Floor((wh - ih) / 2)
}

; Fill overlay for move/resize background
global fillGui        := CreateOverlayGui()

; Resize mode zone tiles
global innerGui       := CreateOverlayGui()
global outerTopGui    := CreateOverlayGui()
global outerBottomGui := CreateOverlayGui()
global outerLeftGui   := CreateOverlayGui()
global outerRightGui  := CreateOverlayGui()
global outerGuis      := [outerTopGui, outerBottomGui, outerLeftGui, outerRightGui]

; Border overlay — transparent bg with GDI-drawn dashed bevel lines
global borderGui  := CreateOverlayGui("010203", "010203")
global borderHwnd := borderGui.Hwnd
global borderW    := 1
global borderH    := 1

; Cross overlay for force close mode
global crossGui  := CreateOverlayGui("010203", "010203")
global crossHwnd := crossGui.Hwnd

pickerPurpleGui := CreatePickerOverlayGui("7B4BA8", true)
pickerRedGui := CreatePickerOverlayGui("D94B4B", true)

; WM_PAINT handler for GDI-drawn borders and crosshairs
OnMessage(0x000F, OnOverlayPaint)
OnMessage(0x02E0, OnOverlayDpiChanged)

OnOverlayPaint(wParam, lParam, msg, hwnd) {
    global borderHwnd, crossHwnd, borderW, borderH
    if (hwnd != borderHwnd && hwnd != crossHwnd)
        return

    ps  := Buffer(64, 0)
    hDC := DllCall("BeginPaint", "Ptr", hwnd, "Ptr", ps, "Ptr")
    w := borderW
    h := borderH
    DllCall("SetBkMode", "Ptr", hDC, "Int", 1)

    if (hwnd == borderHwnd) {
        hWht := DllCall("CreatePen", "Int", 1, "Int", 1, "UInt", 0xFFFFFF, "Ptr")
        DllCall("SelectObject", "Ptr", hDC, "Ptr", hWht)
        DllCall("MoveToEx", "Ptr", hDC, "Int", 0,   "Int", 0,   "Ptr", 0)
        DllCall("LineTo",   "Ptr", hDC, "Int", w,   "Int", 0)
        DllCall("MoveToEx", "Ptr", hDC, "Int", 0,   "Int", 0,   "Ptr", 0)
        DllCall("LineTo",   "Ptr", hDC, "Int", 0,   "Int", h)
        DllCall("MoveToEx", "Ptr", hDC, "Int", 2,   "Int", h-3, "Ptr", 0)
        DllCall("LineTo",   "Ptr", hDC, "Int", w-2, "Int", h-3)
        DllCall("MoveToEx", "Ptr", hDC, "Int", w-3, "Int", 2,   "Ptr", 0)
        DllCall("LineTo",   "Ptr", hDC, "Int", w-3, "Int", h-2)
        hGry := DllCall("CreatePen", "Int", 1, "Int", 1, "UInt", 0x888888, "Ptr")
        DllCall("SelectObject", "Ptr", hDC, "Ptr", hGry)
        DllCall("MoveToEx", "Ptr", hDC, "Int", 0,   "Int", h-1, "Ptr", 0)
        DllCall("LineTo",   "Ptr", hDC, "Int", w,   "Int", h-1)
        DllCall("MoveToEx", "Ptr", hDC, "Int", w-1, "Int", 0,   "Ptr", 0)
        DllCall("LineTo",   "Ptr", hDC, "Int", w-1, "Int", h)
        DllCall("MoveToEx", "Ptr", hDC, "Int", 2,   "Int", 2,   "Ptr", 0)
        DllCall("LineTo",   "Ptr", hDC, "Int", w-2, "Int", 2)
        DllCall("MoveToEx", "Ptr", hDC, "Int", 2,   "Int", 2,   "Ptr", 0)
        DllCall("LineTo",   "Ptr", hDC, "Int", 2,   "Int", h-2)
        DllCall("DeleteObject", "Ptr", hWht)
        DllCall("DeleteObject", "Ptr", hGry)
    } else if (hwnd == crossHwnd) {
        hRed := DllCall("CreatePen", "Int", 0, "Int", 4, "UInt", 0x0000FF, "Ptr")
        DllCall("SelectObject", "Ptr", hDC, "Ptr", hRed)
        DllCall("MoveToEx", "Ptr", hDC, "Int", 0, "Int", 0, "Ptr", 0)
        DllCall("LineTo",   "Ptr", hDC, "Int", w, "Int", h)
        DllCall("MoveToEx", "Ptr", hDC, "Int", w, "Int", 0, "Ptr", 0)
        DllCall("LineTo",   "Ptr", hDC, "Int", 0, "Int", h)
        DllCall("DeleteObject", "Ptr", hRed)
    }

    DllCall("EndPaint", "Ptr", hwnd, "Ptr", ps)
    return 0
}

OnOverlayDpiChanged(wParam, lParam, msg, hwnd) {
    global overlayHwnds, overlayRects
    if !overlayHwnds.Has(hwnd)
        return
    if overlayRects.Has(hwnd) {
        rect := overlayRects[hwnd]
        DllCall("SetWindowPos",
            "Ptr",  hwnd, "Ptr", -1,
            "Int",  rect.x, "Int", rect.y,
            "Int",  rect.w, "Int", rect.h,
            "UInt", 0x0010 | 0x0040)
    }
    return 0
}

; Reset cursors and hide overlays when the script's own window gains focus
OnMessage(0x0006, OnActivate)
OnActivate(wParam, lParam, msg, hwnd) {
    ResetCursors()
    HideOverlays()
}

; ============================================================
; WINDOW HELPERS
; ============================================================

IsSystemWindow(hWnd) {
    try {
        cls := WinGetClass("ahk_id " hWnd)
        return (cls = "Progman" || cls = "WorkerW"
            || cls = "Shell_TrayWnd" || cls = "Shell_SecondaryTrayWnd"
            || cls = "DV2ControlHost" || cls = "tooltips_class32" || cls = "#32768")
    }
    return true
}

IsOverlayWindow(hWnd) {
    global overlayHwnds
    return overlayHwnds.Has(hWnd)
}

NormalizeTargetWindow(hWnd) {
    if !hWnd
        return 0
    rootHwnd := DllCall("GetAncestor", "Ptr", hWnd, "UInt", 2, "Ptr")
    if rootHwnd
        hWnd := rootHwnd
    if !DllCall("IsWindowVisible", "Ptr", hWnd, "Int")
        return 0
    if (IsOverlayWindow(hWnd) || IsSystemWindow(hWnd))
        return 0
    return hWnd
}

UnderlyingWindowAtPoint(overlayHwnd, x, y) {
    ; Picker tints are ordinary proven AHK overlay windows (same family as the
    ; Ctrl+Space surfaces). When one is topmost, walk downward through top-level
    ; z-order to find the first real visible window containing the pointer.
    candidate := overlayHwnd
    Loop 128 {
        candidate := DllCall("GetWindow", "Ptr", candidate, "UInt", 2, "Ptr") ; GW_HWNDNEXT
        if !candidate
            return 0
        if !DllCall("IsWindowVisible", "Ptr", candidate, "Int")
            continue
        rect := Buffer(16, 0)
        if !DllCall("GetWindowRect", "Ptr", candidate, "Ptr", rect)
            continue
        left := NumGet(rect, 0, "Int"), top := NumGet(rect, 4, "Int")
        right := NumGet(rect, 8, "Int"), bottom := NumGet(rect, 12, "Int")
        if (x < left || x >= right || y < top || y >= bottom)
            continue
        target := NormalizeTargetWindow(candidate)
        if target
            return target
    }
    return 0
}

GetMouseTargetInfo() {
    prevDpiContext := SetThreadPerMonitorV2()
    try {
        MouseGetPos(&mx, &my, &hoverWin, &hoverCtrl, 2)
        rawTarget := hoverCtrl ? hoverCtrl : hoverWin
        if IsOverlayWindow(rawTarget)
            targetHwnd := UnderlyingWindowAtPoint(hoverWin, mx, my)
        else
            targetHwnd := NormalizeTargetWindow(rawTarget)
        if (!targetHwnd && hoverCtrl && hoverWin) {
            if IsOverlayWindow(hoverWin)
                targetHwnd := UnderlyingWindowAtPoint(hoverWin, mx, my)
            else
                targetHwnd := NormalizeTargetWindow(hoverWin)
        }
        return {x: mx, y: my, hwnd: targetHwnd, rawWin: hoverWin, rawCtrl: hoverCtrl}
    } finally {
        RestoreThreadDpiContext(prevDpiContext)
    }
}

HideOverlays() {
    global overlayGuis, crossGui
    for gui in overlayGuis
        gui.Hide()
    crossGui.Hide()
}

HideResizeOverlays() {
    global innerGui, outerGuis
    innerGui.Hide()
    for gui in outerGuis
        gui.Hide()
}

ShowBorder(wx, wy, ww, wh) {
    global borderGui, borderW, borderH
    borderW := ww
    borderH := wh
    if PositionOverlay(borderGui, wx, wy, ww, wh) {
        DllCall("InvalidateRect", "Ptr", borderGui.Hwnd, "Ptr", 0, "Int", 1)
        DllCall("UpdateWindow",   "Ptr", borderGui.Hwnd)
    }
}

ShowCross(wx, wy, ww, wh) {
    global crossGui, borderW, borderH
    borderW := ww
    borderH := wh
    if PositionOverlay(crossGui, wx, wy, ww, wh) {
        DllCall("InvalidateRect", "Ptr", crossGui.Hwnd, "Ptr", 0, "Int", 1)
        DllCall("UpdateWindow",   "Ptr", crossGui.Hwnd)
    }
}

MoveWindow(hWnd, x, y, w, h) {
    DllCall("SetWindowPos",
        "Ptr",  hWnd, "Ptr",  0,
        "Int",  Round(x), "Int",  Round(y),
        "Int",  Round(w), "Int",  Round(h),
        "UInt", 0x0014) ; SWP_NOACTIVATE | SWP_NOZORDER
}

IsWindowTopmost(hWnd) {
    return !!(WinGetExStyle("ahk_id " hWnd) & 0x8)
}

RestoreWindowTopmostState(hWnd, wasTopmost) {
    if wasTopmost
        return
    DllCall("SetWindowPos",
        "Ptr",  hWnd,
        "Ptr",  -2, ; HWND_NOTOPMOST
        "Int",  0, "Int", 0, "Int", 0, "Int", 0,
        "UInt", 0x0013) ; SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE
}

HasDragThreshold(startX, startY, curX, curY, threshold := 3) {
    return Abs(curX - startX) >= threshold || Abs(curY - startY) >= threshold
}

HasVerticalThreshold(startY, curY, threshold := 3) {
    return Abs(curY - startY) >= threshold
}

GetMonitorForWindow(hWnd, &mLeft, &mTop, &mRight, &mBottom) {
    WinGetPos(&x, &y, &w, &h, "ahk_id " hWnd)
    cx := x + w // 2
    cy := y + h // 2
    Loop MonitorGetCount() {
        MonitorGetWorkArea(A_Index, &l, &t, &r, &b)
        if (cx >= l && cx < r && cy >= t && cy < b) {
            mLeft := l, mTop := t, mRight := r, mBottom := b
            return
        }
    }
    MonitorGetWorkArea(MonitorGetPrimary(), &mLeft, &mTop, &mRight, &mBottom)
}

ScaleWindow(hWnd, origW, origH, centerX, centerY, scale, maxW, maxH) {
    aspect := origW / origH
    newH := origH * scale
    newW := newH * aspect
    if (newW > maxW || newH > maxH) {
        if (newW / maxW > newH / maxH)
            newW := maxW, newH := newW / aspect
        else
            newH := maxH, newW := newH * aspect
    }
    newW := Max(newW, 140)
    newH := Max(newH, 140)
    MoveWindow(hWnd, centerX - newW / 2, centerY - newH / 2, newW, newH)
}

BeginWindowManipulation(hWnd, &anchorMouseX, &anchorMouseY, &startX, &startY, &startW, &startH, restore := true) {
    wasTopmost := IsWindowTopmost(hWnd)
    ActivateTargetWindow(hWnd, restore)
    MouseGetPos(&anchorMouseX, &anchorMouseY)
    WinGetPos(&startX, &startY, &startW, &startH, "ahk_id " hWnd)
    return wasTopmost
}

RaiseWindow(hWnd) {
    if !hWnd
        return
    DllCall("SetWindowPos",
        "Ptr",  hWnd,
        "Ptr",  0, ; HWND_TOP
        "Int",  0, "Int", 0, "Int", 0, "Int", 0,
        "UInt", 0x0013) ; SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE
}

; Adaptive activation: only activates focus if target window is not already active
ActivateTargetWindow(hWnd, restore := true) {
    if !hWnd
        return

    physical := IsPhysicalInput()
    if (WinActive("ahk_id " hWnd) = 0) {
        if restore {
            state := 0
            try state := WinGetMinMax("ahk_id " hWnd)
            if physical {
                ; Main machine: restore from any non-normal state
                if state
                    WinRestore("ahk_id " hWnd)
            } else {
                ; Secondary machine (MWB): only restore if minimized
                if (state = -1)
                    WinRestore("ahk_id " hWnd)
            }
        }

        ; Unconditionally activate window to guarantee it goes in front natively
        WinActivate("ahk_id " hWnd)
    }
}

; ============================================================
; OVERLAY TIMER (16ms → ~60 FPS update interval)
; ============================================================

UpdateOverlay() {
    global fillGui, innerGui, crossGui, spacePressed, activeTargetHwnd
    global ctrlSpaceLatched, moveSelected, movingWindowHwnd
    global outerTopGui, outerBottomGui, outerLeftGui, outerRightGui
    prevDpiContext := SetThreadPerMonitorV2()

    try {
        ; The Papers button writes one explicit activation signal after its
        ; authenticated endpoint is listening. An idle engine performs only a
        ; cheap file-existence check; it never blocks the shared AHK input loop
        ; by polling HTTP. Once activated, hover and click work immediately.
        CheckPickerActivation()
        UpdatePickerMode()
        if ctrlSpaceLatched
            RefreshMoveSelections()
        if IsMouseOverCSP() {
            activeTargetHwnd := 0
            HideOverlays()
            ResetCursors()
            return
        }

        moveMode   := IsMoveModeActive()
        resizeMode := IsResizeModeActive()
        closeMode  := ForceCloseModeActive()

        ; Picker owns the unmodified pointer only. Holding an established
        ; SlopTop chord temporarily gives the ordinary local mode full control.
        if pickerActive && !moveMode && !resizeMode && !closeMode {
            ; A chord may end while the picker remains active. Clear the
            ; ordinary mode's final frame before handing the pointer back;
            ; otherwise its last blue/red overlay stays frozen onscreen.
            activeTargetHwnd := 0
            HideOverlays()
            ResetCursors()
            return
        }

        if (!moveMode && !resizeMode && !closeMode) {
            activeTargetHwnd := 0
            if spacePressed {
                spacePressed := false
                SendInput("{Space Up}")
            }
            HideOverlays()
            ResetCursors()
            return
        }

        MouseGetPos(&mx, &my)

        ; Sticky bounds target tracking logic
        if activeTargetHwnd {
            try {
                GetVisibleRect(activeTargetHwnd, &rx, &ry, &rw, &rh)
                if (mx < rx || mx >= rx + rw || my < ry || my >= ry + rh) {
                    activeTargetHwnd := 0
                }
            } catch {
                activeTargetHwnd := 0
            }
        }

        if !activeTargetHwnd {
            ; Hide overlays temporarily to allow perfect, unblocked OS hit-testing
            HideOverlays()

            target := GetMouseTargetInfo()
            if target.hwnd {
                activeTargetHwnd := target.hwnd
            }
        }

        hWnd := activeTargetHwnd
        if !hWnd {
            HideOverlays()
            ResetCursors()
            return
        }

        try {
            GetVisibleRect(hWnd, &wx, &wy, &ww, &wh)
        } catch {
            HideOverlays()
            ResetCursors()
            return
        }

        if (ww <= 0 || wh <= 0) {
            HideOverlays()
            ResetCursors()
            return
        }

        if closeMode {
            SetGlobalCursor(squashCursorPath, "squash")
            HideResizeOverlays()
            ShowTint(fillGui, wx, wy, ww, wh, "FF0000", 40)
            ShowBorder(wx, wy, ww, wh)
            ShowCross(wx, wy, ww, wh)
            return
        }

        if moveMode {
            SetGlobalCursor(moveCursorPath, "move")
            if moveSelected.Count {
                HideOverlays()
                return
            }
            HideResizeOverlays()
            crossGui.Hide()
            ShowTint(fillGui, wx, wy, ww, wh, "3388FF", 40)
            ShowBorder(wx, wy, ww, wh)
            return
        }

        if ctrlSpaceLatched && movingWindowHwnd && moveSelected.Count {
            SetGlobalCursor(squashCursorPath, "squash")
            HideOverlays()
            return
        }

        ; Resize mode
        crossGui.Hide()
        GetInnerZone(wx, wy, ww, wh, &ix, &iy, &iw, &ih)
        inInner := (mx >= ix && mx < ix + iw && my >= iy && my < iy + ih)

        if inInner {
            SetGlobalCursor(voreCursorPath, "vore")
            ShowTint(innerGui, ix, iy, iw, ih, "00FF00", 40)
            for gui in outerGuis
                gui.Hide()
        } else {
            SetGlobalCursor(squashCursorPath, "squash")
            innerGui.Hide()
            ShowTint(outerTopGui,    wx,      wy,      ww,         iy - wy,               "00FF00", 25)
            ShowTint(outerBottomGui, wx,      iy + ih, ww,         (wy + wh) - (iy + ih), "00FF00", 25)
            ShowTint(outerLeftGui,   wx,      iy,      ix - wx,    ih,                    "00FF00", 25)
            ShowTint(outerRightGui,  ix + iw, iy,      (wx + ww) - (ix + iw), ih,        "00FF00", 25)
        }
        ShowTint(fillGui, wx, wy, ww, wh, "FF0000", 15)
        ShowBorder(wx, wy, ww, wh)
    } finally {
        RestoreThreadDpiContext(prevDpiContext)
    }
}

SetTimer(UpdateOverlay, 16)

; ============================================================
; HOTKEYS
; ============================================================

; Clicking the Papers picker button activates this local mode directly. No
; modifier chord is required. Established SlopTop chords temporarily retain
; their own mouse behavior; unmodified left click toggles the topmost window.
#HotIf pickerActive && !PickerOrdinaryModeActive()
*LButton:: {
    global pickerSelected, pickerHoverVisualKey
    target := GetMouseTargetInfo()
    if !target.hwnd
        return
    PickerTrace("local click hwnd=" target.hwnd)
    if pickerSelected.Has(target.hwnd) {
        RemovePickerSelection(target.hwnd)
        PickerTrace("selection removed hwnd=" target.hwnd " count=" pickerSelected.Count)
    } else {
        added := AddPickerSelection(target.hwnd)
        PickerTrace((added ? "selection added hwnd=" : "selection rejected hwnd=") target.hwnd " count=" pickerSelected.Count)
    }
    pickerHoverVisualKey := ""
    UpdatePickerMode()
}
#HotIf

#HotIf pickerActive
*Enter:: {
    global pickerToken, pickerResultPath
    commitToken := pickerToken
    selected := PickerSnapshot()
    PickerTrace("commit requested count=" selected.Length)
    StopPickerMode(false)
    PickerAtomicWrite(pickerResultPath, PickerCommitBody(commitToken, selected))
}

*Escape:: {
    StopPickerMode(true)
}
#HotIf

; Space suppression — blocks Space from reaching the active window on both machines
#HotIf !IsMouseOverCSP() && (ctrlSpaceArmed || ctrlSpaceLatched || GetEngineKeyState("Ctrl"))
*Space:: {
    global spacePressed, ctrlSpaceActivationDown, ctrlSpaceArmed, ctrlSpaceLatched, ctrlSpaceHoldPending
    global moveSelected, movingWindowHwnd, movingWindows, movingRightDownAt, activeTargetHwnd
    global movingMode, movingStartedWithShift
    if ctrlSpaceActivationDown
        return
    ctrlSpaceActivationDown := true
    if ctrlSpaceLatched {
        if moveSelected.Count {
            if movingWindowHwnd {
                UpdateMovingWindow()
                SetTimer(UpdateMovingWindow, 0)
                movingWindowHwnd := 0
                movingWindows := Map()
                movingRightDownAt := 0
                movingMode := ""
                movingStartedWithShift := false
            }
            ClearMoveSelections()
            activeTargetHwnd := 0
            HideOverlays()
            return
        }
        ExitLatchedCtrlSpaceMode()
        return
    }
    if ctrlSpaceArmed && !GetKeyState("Ctrl", "P") {
        ctrlSpaceArmed := false
        ctrlSpaceLatched := true
        return
    }
    ctrlSpaceArmed := false
    ctrlSpaceLatched := true
    ctrlSpaceHoldPending := true
    SetTimer(ConfirmHeldCtrlSpace, -100)
}
#HotIf

#HotIf spacePressed || ctrlSpaceActivationDown
*Space Up:: {
    global spacePressed, ctrlSpaceActivationDown
    spacePressed := false
    ctrlSpaceActivationDown := false
}
#HotIf

; Tap Ctrl, then Space to keep the mode active after releasing both keys.
~*LCtrl::ArmSequentialCtrlSpace()
~*RCtrl::ArmSequentialCtrlSpace()

ArmSequentialCtrlSpace() {
    global ctrlSpaceArmed, ctrlSpaceLatched, ctrlSpaceHoldPending, spacePressed
    if ctrlSpaceHoldPending
        return
    ; Ctrl is the selection modifier while the move mode is latched.
    if ctrlSpaceLatched
        return
    if spacePressed || IsMouseOverCSP()
        return
    ctrlSpaceArmed := true
    StartCtrlSpaceKeyWatcher()
}

ConfirmHeldCtrlSpace() {
    global ctrlSpaceHoldPending, ctrlSpaceLatched, ctrlSpaceKeyWatcher, spacePressed
    if !ctrlSpaceHoldPending
        return
    ctrlSpaceHoldPending := false
    if !GetEngineKeyState("Ctrl") || !GetKeyState("Space", "P")
        return
    ctrlSpaceLatched := false
    spacePressed := true
    if ctrlSpaceKeyWatcher
        ctrlSpaceKeyWatcher.Stop()
}

StartCtrlSpaceKeyWatcher() {
    global ctrlSpaceKeyWatcher
    if ctrlSpaceKeyWatcher
        ctrlSpaceKeyWatcher.Stop()
    ctrlSpaceKeyWatcher := InputHook("V")
    ctrlSpaceKeyWatcher.KeyOpt("{All}", "N")
    ctrlSpaceKeyWatcher.OnKeyDown := CtrlSpaceKeyDown
    ctrlSpaceKeyWatcher.Start()
}

CtrlSpaceKeyDown(ih, vk, sc) {
    global ctrlSpaceArmed, ctrlSpaceLatched
    ; Shift switches a latched move to resize while held. Space is handled
    ; by its hotkey, so a second Space can explicitly exit the mode.
    if (vk = 0x10 || vk = 0xA0 || vk = 0xA1 || vk = 0x20
        || vk = 0x11 || vk = 0xA2 || vk = 0xA3)
        return
    if ctrlSpaceLatched {
        ExitLatchedCtrlSpaceMode()
    } else if ctrlSpaceArmed {
        ctrlSpaceArmed := false
        ih.Stop()
    }
}

ExitLatchedCtrlSpaceMode() {
    global ctrlSpaceArmed, ctrlSpaceLatched, ctrlSpaceHoldPending, ctrlSpaceKeyWatcher
    global movingWindowHwnd, movingRightDownAt, movingWindows, rButtonDragging, mButtonDragging, activeTargetHwnd
    global movingMode, movingStartedWithShift
    ctrlSpaceArmed := false
    ctrlSpaceLatched := false
    ctrlSpaceHoldPending := false
    SetTimer(ConfirmHeldCtrlSpace, 0)
    movingWindowHwnd := 0
    movingRightDownAt := 0
    movingWindows := Map()
    movingMode := ""
    movingStartedWithShift := false
    ClearMoveSelections()
    rButtonDragging := false
    mButtonDragging := false
    activeTargetHwnd := 0
    SetTimer(UpdateMovingWindow, 0)
    if ctrlSpaceKeyWatcher
        ctrlSpaceKeyWatcher.Stop()
    HideOverlays()
    ResetCursors()
}

; ============================================================
; Ctrl + Shift + Alt — Force Close
; ============================================================

#HotIf ForceCloseModeActive() && !IsMouseOverCSP()
*LButton:: {
    global activeTargetHwnd
    hWnd := activeTargetHwnd
    if !hWnd
        return
    WinKill("ahk_id " hWnd)
}
#HotIf

; ============================================================
; Ctrl + Space — Move mode
; ============================================================

#HotIf IsMoveModeActive() && !IsMouseOverCSP()
*LButton:: {
    global activeTargetHwnd, ctrlSpaceLatched
    if ctrlSpaceLatched && !GetMouseTargetInfo().hwnd {
        ExitLatchedCtrlSpaceMode()
        return
    }
    hWnd := activeTargetHwnd
    if !hWnd
        return
    wasTopmost := IsWindowTopmost(hWnd)
    ActivateTargetWindow(hWnd)
    if savedPos.Has(hWnd) {
        p := savedPos[hWnd]
        WinSetStyle("+0xC40000", "ahk_id " hWnd)
        MoveWindow(hWnd, p.x, p.y, p.w, p.h)
        savedPos.Delete(hWnd)
    } else {
        WinGetPos(&x, &y, &w, &h, "ahk_id " hWnd)
        savedPos[hWnd] := {x: x, y: y, w: w, h: h}
        GetMonitorForWindow(hWnd, &mLeft, &mTop, &mRight, &mBottom)
        WinSetStyle("-0xC40000", "ahk_id " hWnd)
        MoveWindow(hWnd, mLeft, mTop, mRight - mLeft, mBottom - mTop)
    }
    RestoreWindowTopmostState(hWnd, wasTopmost)
    RaiseWindow(hWnd)
}

*WheelUp:: {
    global activeTargetHwnd
    hWnd := activeTargetHwnd
    if !hWnd
        return
    wasTopmost := IsWindowTopmost(hWnd)
    ActivateTargetWindow(hWnd)
    WinGetPos(&x, &y, &w, &h, "ahk_id " hWnd)
    GetMonitorForWindow(hWnd, &mLeft, &mTop, &mRight, &mBottom)
    ScaleWindow(hWnd, w, h, x + w / 2, y + h / 2, 1.10, mRight - mLeft - 60, mBottom - mTop - 60)
    RestoreWindowTopmostState(hWnd, wasTopmost)
    RaiseWindow(hWnd)
}

*WheelDown:: {
    global activeTargetHwnd
    hWnd := activeTargetHwnd
    if !hWnd
        return
    wasTopmost := IsWindowTopmost(hWnd)
    ActivateTargetWindow(hWnd)
    WinGetPos(&x, &y, &w, &h, "ahk_id " hWnd)
    GetMonitorForWindow(hWnd, &mLeft, &mTop, &mRight, &mBottom)
    ScaleWindow(hWnd, w, h, x + w / 2, y + h / 2, 0.90, mRight - mLeft - 60, mBottom - mTop - 60)
    RestoreWindowTopmostState(hWnd, wasTopmost)
    RaiseWindow(hWnd)
}

*MButton:: {
    global activeTargetHwnd, ctrlSpaceLatched
    if ctrlSpaceLatched && !GetMouseTargetInfo().hwnd {
        ExitLatchedCtrlSpaceMode()
        return
    }
    hWnd := activeTargetHwnd
    if !hWnd
        return
    WinMinimize("ahk_id " hWnd)
}

; RMB — click once to pick up the window, click again to place it.
#HotIf movingWindowHwnd || (ctrlSpaceLatched && !IsMouseOverCSP()) || (IsMoveModeActive() && !IsMouseOverCSP())
*RButton:: {
    global activeTargetHwnd, movingWindowHwnd, movingWindowOffsetX, movingWindowOffsetY
    global movingRightDownAt, movingWindows, movingAnchorMouseX, movingAnchorMouseY
    global movingMode, movingStartedWithShift
    global moveSelected, rButtonDragging, ctrlSpaceLatched
    if ctrlSpaceLatched && GetKeyState("Ctrl", "P") {
        if movingWindowHwnd {
            UpdateMovingWindow()
            SetTimer(UpdateMovingWindow, 0)
            movingWindowHwnd := 0
            movingWindows := Map()
            movingRightDownAt := 0
            movingMode := ""
            movingStartedWithShift := false
        }
        HideOverlays()
        target := GetMouseTargetInfo().hwnd
        if target
            ToggleMoveSelection(target)
        return
    }
    if movingWindowHwnd {
        UpdateMovingWindow()
        SetTimer(UpdateMovingWindow, 0)
        movingWindowHwnd := 0
        movingWindows := Map()
        movingRightDownAt := 0
        movingMode := ""
        movingStartedWithShift := false
        activeTargetHwnd := 0
        return
    }
    CoordMode("Mouse", "Screen")
    ; The overlay's cached target may still be empty or stale after placing
    ; a window. Resolve the window under this click for every new pickup.
    HideOverlays()
    hWnd := GetMouseTargetInfo().hwnd
    if !hWnd && ctrlSpaceLatched && moveSelected.Count {
        ; An empty desktop click can anchor a move of the selected group.
        for selectedHwnd, entry in moveSelected {
            try {
                if WinExist("ahk_id " selectedHwnd) && WinGetPID("ahk_id " selectedHwnd) = entry.pid {
                    hWnd := selectedHwnd
                    break
                }
            }
        }
    }
    if !hWnd {
        if ctrlSpaceLatched
            ExitLatchedCtrlSpaceMode()
        return
    }
    activeTargetHwnd := hWnd
    ActivateTargetWindow(hWnd)

    MouseGetPos(&startMouseX, &startMouseY)
    WinGetPos(&WinX, &WinY, , , "ahk_id " hWnd)
    movingWindowOffsetX := startMouseX - WinX
    movingWindowOffsetY := startMouseY - WinY
    SetWinDelay(-1)
    if !ctrlSpaceLatched {
        rButtonDragging := true
        while rButtonDragging && GetKeyState("RButton", "P") && !GetKeyState("Shift") {
            MouseGetPos(&currentX, &currentY)
            DllCall("SetWindowPos", "Ptr", hWnd, "Ptr", 0,
                "Int", currentX - movingWindowOffsetX, "Int", currentY - movingWindowOffsetY,
                "Int", 0, "Int", 0, "UInt", 0x0415)
            Sleep(1)
        }
        rButtonDragging := false
        RaiseWindow(hWnd)
        return
    }
    movingWindows := Map()
    movingAnchorMouseX := startMouseX
    movingAnchorMouseY := startMouseY
    if moveSelected.Count {
        for selectedHwnd, entry in moveSelected {
            try {
                if !WinExist("ahk_id " selectedHwnd) || WinGetPID("ahk_id " selectedHwnd) != entry.pid
                    continue
                WinGetPos(&selectedX, &selectedY, , , "ahk_id " selectedHwnd)
                GetVisibleRect(selectedHwnd, &visibleX, &visibleY, &visibleW, &visibleH)
                movingWindows[selectedHwnd] := {x: selectedX, y: selectedY,
                    vx: visibleX, vy: visibleY, vw: visibleW, vh: visibleH}
            }
        }
    } else {
        GetVisibleRect(hWnd, &visibleX, &visibleY, &visibleW, &visibleH)
        movingWindows[hWnd] := {x: WinX, y: WinY,
            vx: visibleX, vy: visibleY, vw: visibleW, vh: visibleH}
    }
    if !movingWindows.Count
        return
    for selectedHwnd in movingWindows {
        movingWindowHwnd := selectedHwnd
        break
    }
    movingRightDownAt := A_TickCount
    movingStartedWithShift := GetEngineKeyState("Shift")
    movingMode := movingStartedWithShift ? "pending" : "move"
    SetTimer(UpdateMovingWindow, 10)
    RaiseWindow(hWnd)
}
#HotIf

UpdateMovingWindow() {
    global movingWindowHwnd, movingWindows, movingAnchorMouseX, movingAnchorMouseY, moveSelected
    global movingMode, movingStartedWithShift, movingRightDownAt, movingResizeReferenceHeight
    if !movingWindowHwnd
        return
    MouseGetPos(&currentX, &currentY)
    if (movingStartedWithShift && movingRightDownAt
        && (A_TickCount - movingRightDownAt <= 100) && GetKeyState("RButton", "P"))
        return

    wantedMode := GetEngineKeyState("Shift") ? "resize" : "move"
    if (movingMode != wantedMode) {
        pending := (movingMode = "pending")
        originalAnchorX := movingAnchorMouseX
        originalAnchorY := movingAnchorMouseY
        RebaseMovingWindows(currentX, currentY)
        if !movingWindowHwnd
            return
        if pending {
            movingAnchorMouseX := originalAnchorX
            movingAnchorMouseY := originalAnchorY
        }
        movingMode := wantedMode
    }

    dx := currentX - movingAnchorMouseX
    dy := currentY - movingAnchorMouseY
    anyLive := false
    for hWnd, origin in movingWindows {
        if !WinExist("ahk_id " hWnd)
            continue
        anyLive := true
        if (movingMode = "resize") {
            scale := Max(0.15, 1.0 - (dy / movingResizeReferenceHeight) * 3.0)
            ScaleWindow(hWnd, origin.w, origin.h,
                origin.x + origin.w / 2, origin.y + origin.h / 2,
                scale, origin.maxW, origin.maxH)
            if moveSelected.Has(hWnd) {
                GetVisibleRect(hWnd, &visibleX, &visibleY, &visibleW, &visibleH)
                PositionPickerBorder(moveSelected[hWnd].tint, hWnd,
                    visibleX, visibleY, visibleW, visibleH)
            }
        } else {
            DllCall("SetWindowPos", "Ptr", hWnd, "Ptr", 0,
                "Int", origin.x + dx, "Int", origin.y + dy,
                "Int", 0, "Int", 0, "UInt", 0x0415)
            if moveSelected.Has(hWnd)
                PositionPickerBorder(moveSelected[hWnd].tint, hWnd,
                    origin.vx + dx, origin.vy + dy, origin.vw, origin.vh)
        }
    }
    if !anyLive {
        SetTimer(UpdateMovingWindow, 0)
        movingWindowHwnd := 0
        movingWindows := Map()
        movingMode := ""
    }
}

RebaseMovingWindows(mouseX, mouseY) {
    global movingWindowHwnd, movingWindows, movingAnchorMouseX, movingAnchorMouseY
    global movingResizeReferenceHeight
    live := Map()
    movingWindowHwnd := 0
    movingResizeReferenceHeight := 1
    for hWnd in movingWindows {
        try {
            if !WinExist("ahk_id " hWnd)
                continue
            WinGetPos(&x, &y, &w, &h, "ahk_id " hWnd)
            if (w <= 0 || h <= 0)
                continue
            GetVisibleRect(hWnd, &vx, &vy, &vw, &vh)
            GetMonitorForWindow(hWnd, &left, &top, &right, &bottom)
            live[hWnd] := {x: x, y: y, w: w, h: h, vx: vx, vy: vy, vw: vw, vh: vh,
                maxW: Max(140, right - left - 60), maxH: Max(140, bottom - top - 60)}
            movingResizeReferenceHeight := Max(movingResizeReferenceHeight, h)
            if !movingWindowHwnd
                movingWindowHwnd := hWnd
        }
    }
    movingWindows := live
    movingAnchorMouseX := mouseX
    movingAnchorMouseY := mouseY
    if !movingWindowHwnd
        SetTimer(UpdateMovingWindow, 0)
}

; ============================================================
; Ctrl + Shift + Space — Resize mode
; ============================================================

#HotIf IsResizeModeActive() && !movingWindowHwnd && !IsMouseOverCSP()
~*LButton:: {
    global ctrlSpaceLatched
    if ctrlSpaceLatched && !GetMouseTargetInfo().hwnd
        ExitLatchedCtrlSpaceMode()
}

#HotIf !ctrlSpaceLatched && IsResizeModeActive() && !movingWindowHwnd && !IsMouseOverCSP()
*RButton:: {
    global rButtonDragging, activeTargetHwnd, ctrlSpaceLatched
    if ctrlSpaceLatched && !GetMouseTargetInfo().hwnd {
        ExitLatchedCtrlSpaceMode()
        return
    }
    CoordMode("Mouse", "Screen")
    hWnd := activeTargetHwnd
    if !hWnd
        return
    wasTopmost := BeginWindowManipulation(hWnd, &startMouseX, &startMouseY, &startX, &startY, &startW, &startH)
    GetMonitorForWindow(hWnd, &mLeft, &mTop, &mRight, &mBottom)

    ; Inner zone (center 50%): uniform scale drag
    ix := startX + Round(startW * 0.25)
    iy := startY + Round(startH * 0.25)
    iw := Round(startW * 0.50)
    ih := Round(startH * 0.50)
    insideInner := (startMouseX >= ix && startMouseX <= ix + iw
                 && startMouseY >= iy && startMouseY <= iy + ih)

    if insideInner {
        centerX := startX + startW / 2
        centerY := startY + startH / 2
        currentScale := 1.0
        maxW := mRight - mLeft - 60
        maxH := mBottom - mTop - 60
        DllCall("timeBeginPeriod", "UInt", 1)
        dragStarted := false
        rButtonDragging := true
        while rButtonDragging {
            MouseGetPos(, &curY)
            if !dragStarted && !HasVerticalThreshold(startMouseY, curY) {
                Sleep(8)
                continue
            }
            dragStarted := true
            delta := startMouseY - curY
            targetScale := Max(1.0 + (delta / startH) * 3.0, 0.15)
            currentScale += (targetScale - currentScale) * 0.12
            ScaleWindow(hWnd, startW, startH, centerX, centerY, currentScale, maxW, maxH)
            Sleep(8)
        }
        DllCall("timeEndPeriod", "UInt", 1)
        RestoreWindowTopmostState(hWnd, wasTopmost)
        RaiseWindow(hWnd)
        return
    }

    ; Outer zone: edge resize
    centerX := startX + startW / 2
    centerY := startY + startH / 2
    resizeLeft := (startMouseX < centerX)
    resizeTop  := (startMouseY < centerY)
    DllCall("timeBeginPeriod", "UInt", 1)
    dragStarted := false
    rButtonDragging := true
    while rButtonDragging {
        MouseGetPos(&curX, &curY)
        if !dragStarted && !HasDragThreshold(startMouseX, startMouseY, curX, curY) {
            Sleep(1)
            continue
        }
        dragStarted := true
        dx := curX - startMouseX
        dy := curY - startMouseY
        newX := startX, newY := startY, newW := startW, newH := startH
        if resizeLeft
            newX := startX + dx, newW := startW - dx
        else
            newW := startW + dx
        if resizeTop
            newY := startY + dy, newH := startH - dy
        else
            newH := startH + dy
        MoveWindow(hWnd, newX, newY, Max(newW, 140), Max(newH, 140))
        Sleep(1)
    }
    DllCall("timeEndPeriod", "UInt", 1)
    RestoreWindowTopmostState(hWnd, wasTopmost)
    RaiseWindow(hWnd)
}

; MMB — smooth proportional scale drag
#HotIf IsResizeModeActive() && !movingWindowHwnd && !IsMouseOverCSP()
*MButton:: {
    global mButtonDragging, activeTargetHwnd, ctrlSpaceLatched
    if ctrlSpaceLatched && !GetMouseTargetInfo().hwnd {
        ExitLatchedCtrlSpaceMode()
        return
    }
    CoordMode("Mouse", "Screen")
    hWnd := activeTargetHwnd
    if !hWnd
        return
    wasTopmost := BeginWindowManipulation(hWnd, &mx, &my, &wx, &wy, &ww, &wh)
    GetMonitorForWindow(hWnd, &mLeft, &mTop, &mRight, &mBottom)

    startMouseY := my
    startW := ww, startH := wh
    centerX := wx + ww / 2, centerY := wy + wh / 2
    currentScale := 1.0
    maxW := mRight - mLeft - 60, maxH := mBottom - mTop - 60

    DllCall("timeBeginPeriod", "UInt", 1)
    dragStarted := false
    mButtonDragging := true
    while mButtonDragging {
        MouseGetPos(, &curY)
        if !dragStarted && !HasVerticalThreshold(startMouseY, curY) {
            Sleep(8)
            continue
        }
        dragStarted := true
        delta := startMouseY - curY
        targetScale := Max(1.0 + (delta / startH) * 3.0, 0.15)
        currentScale += (targetScale - currentScale) * 0.12
        ScaleWindow(hWnd, startW, startH, centerX, centerY, currentScale, maxW, maxH)
        Sleep(8)
    }
    DllCall("timeEndPeriod", "UInt", 1)
    RestoreWindowTopmostState(hWnd, wasTopmost)
    RaiseWindow(hWnd)
}
#HotIf

; ============================================================
; DRAG RELEASE SAFETY ESCAPERS
; Fire on button-up to break drag loops even if modifiers are
; released slightly before the mouse button.
; ============================================================

#HotIf rButtonDragging || (ctrlSpaceLatched && movingWindowHwnd)
*RButton Up:: {
    global rButtonDragging, movingWindowHwnd, movingWindows, movingRightDownAt, activeTargetHwnd
    global movingMode, movingStartedWithShift
    if rButtonDragging {
        rButtonDragging := false
        return
    }
    heldLongEnough := movingRightDownAt && (A_TickCount - movingRightDownAt > 100)
    if movingWindowHwnd && (heldLongEnough || movingStartedWithShift) {
        if heldLongEnough
            UpdateMovingWindow()
        SetTimer(UpdateMovingWindow, 0)
        movingWindowHwnd := 0
        movingWindows := Map()
        movingMode := ""
        movingStartedWithShift := false
        activeTargetHwnd := 0
    }
    movingRightDownAt := 0
}
#HotIf

#HotIf mButtonDragging
*MButton Up:: {
    global mButtonDragging
    mButtonDragging := false
}
#HotIf
