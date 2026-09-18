# Papers native foreign-window host

This is a deliberately small, machine-local companion for the original Papers
foreign-window layout feature. Papers compiles `WindowLayoutBroker.cs` once with
the Windows `csc.exe` already present on the machine and caches the executable
under Papers user data. No service, installer, admin elevation, socket server,
or separate runtime is required.

The feature is real native hosting, not desktop placement: Papers creates one
child pane host under its own HWND, then temporarily reparents the selected
external HWND into that host. The external window is restored to its original
parent, styles and rectangle on release. An application that does not survive
this reversible adoption is rejected instead of being moved around the desktop.

The process speaks JSON Lines on stdin/stdout:

```json
{"cmd":"host-create","surfaceId":"foreign-1","papersHwnd":"123456","requestId":"1"}
{"cmd":"adopt","surfaceId":"foreign-1","windowInstanceId":"W0123456789abcdef","requestId":"2"}
{"cmd":"host-bounds","surfaceId":"foreign-1","x":20,"y":80,"w":900,"h":700,"requestId":"3"}
{"cmd":"host-visible","surfaceId":"foreign-1","visible":true,"requestId":"4"}
{"cmd":"release","surfaceId":"foreign-1","requestId":"5"}
```

The broker discovers a foreign HWND from Papers' existing
`Papers.WindowInstanceId.v1` property, changes its top-level style to a child
style, and uses `SetParent` to place it under the native pane host. Bounds are
Papers client coordinates, so moving Papers moves the entire child hierarchy
without a renderer loop or WinEvent follower. EOF on stdin restores every
still-verifiable original parent/style/rectangle and exits.

If compilation or launch is unavailable, Papers refuses native hosting for that
surface rather than silently falling back to desktop teleportation. Picker,
persistence and workspace hydration remain owned by the existing Papers product
layer.
