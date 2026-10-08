# Native window gestures

Papers owns SlopTop's useful desktop gestures and Direct Pick in its resident native `window-control` process. AutoHotkey is not required. Closing Papers removes its hooks and temporary feedback. The independent display-toggle AHK stays running.

## Controls

| Input | Behavior |
| --- | --- |
| Hold Ctrl+Space | Move mode while held. |
| Tap Ctrl+Space, or tap Ctrl then Space within one second | Latch move mode after releasing the keys. |
| Space in latched mode | Clear temporary selection first; with no selection, exit. |
| Another non-modifier key | Exit latched mode and pass the key to the app. Escape cancels without typing. |
| Right drag | Move the window under the pointer. |
| Short right click in latched mode | Pick up the window; click again to place. A held drag ends on release. |
| Ctrl+right click in latched mode | Toggle a temporary window selection. Pick up the selection together, including from the empty desktop. |
| Shift+right drag | Resize from the nearest corner in the outer region; drag vertically in the center 50% to scale proportionally around its center. |
| Shift+middle drag | Smooth proportional scale from anywhere in the window. |
| Shift during a latched pickup | Switch move/resize, rebasing at the pointer to avoid a jump. |
| Left click in move mode | Maximize/restore the target. |
| Middle click in move mode | Minimize the target. |
| Wheel in move mode | Scale by 10%, centered, bounded to the monitor work area. |
| Add Alt to a move drag | Move the target's existing Papers widget group together. |
| Ctrl+Shift+Alt+left click | Force-close the target window, then its process if it refuses to close. |

Clip Studio Paint and Krita keep their drawing chords, including Space itself. Native and injected key events use the same state machine. Desktop, taskbars, menus and tooltips are excluded targets. Fixed-size windows do not enter drag resizing. Topmost status is retained.

Custom move/squash/vore cursors are bundled from the creator's original script. They are shown locally during the interaction, without replacing the system cursor scheme. Feedback copies the original AHK activation and visual style: blue move tint with a dashed white/gray bevel; Shift switches to red-backed green center/outer resize zones; Ctrl+Shift+Alt takes priority with a red tint and cross. Temporary move selections use blue fills and suppress ordinary hover feedback during group pickup. Direct Pick uses purple hover, green selected borders, and a red removal hover. Feedback clears when the mode ends or the pointer has no eligible target. Overlays use true per-pixel alpha and are disabled, click-through, non-activating windows, trimmed to DWM visible bounds.

## Ownership and recovery

Temporary multi-selection exists only for the current latched interaction and is cleared on mode exit. It never writes another durable group or selection store. Durable groups remain the existing Papers capability registrations. Direct Pick continues to return validated identities through the existing v3 protocol; only positively toggled-off seeds count as removals. Reselecting cancels a removal. Ordinary gesture chords can temporarily operate while a picker is open.

The service emits move/resize lifecycle notifications so attached pane windows retain their accepted placement rules. Only Chrome's left edge controls its split. Fullscreen behavior stays with the pane host. The gesture timer performs geometry changes locally; no renderer pointer round trip is involved. Hook callbacks queue work instead of blocking on drag loops.

The AHK's startup notification, script-killing logic and separate resident owner are retired. The original script is preserved, and its startup shortcut is under `Startup/_disabled_by_cleanup/SlopTop-replaced-by-Papers-20261008.lnk`. Native gestures suspend if that script is manually restarted.

The native helper inherits Papers' Windows integrity level. Unlike the old AHK, it does not elevate automatically. Controlling elevated applications requires Papers to run at the matching level; no privileged control or elevation bypass is installed.

## Verification

`--gesture-selftest` checks the actual pure key state machine and geometry: held/tapped/sequential activation, expiry, modifier handling, Escape, suppressed key repeats, painting passthrough, negative monitor coordinates, anchored minimum sizing, proportional scaling and monitor limits. It installs no hooks and sends no input.

`--gesture-window-selftest` creates hidden private fixture windows only, verifies native group moves, consumed-button corner resizing, middle-button scaling, release/cancel cleanup, temporary multi-selection and positive picker removals. It never activates a window or moves the real pointer. `tests/unit/nativeWindowGestures.test.ts` compiles and runs both modes on Windows. Real input smoothness still needs the creator's hands-on check.

