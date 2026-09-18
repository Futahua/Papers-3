# Papers window layout broker

This is a deliberately small, machine-local companion for the original Papers
foreign-window layout feature. Papers compiles `WindowLayoutBroker.cs` once with
the Windows `csc.exe` already present on the machine and caches the executable
under Papers user data. No service, installer, admin elevation, socket server,
or separate runtime is required.

The process speaks JSON Lines on stdin/stdout:

```json
{"cmd":"host","hwnd":"123456","requestId":"1"}
{"cmd":"bind","surfaceId":"foreign-1","windowInstanceId":"W0123456789abcdef","requestId":"2"}
{"cmd":"layout","items":[{"surfaceId":"foreign-1","x":20,"y":80,"w":900,"h":700}],"requestId":"3"}
{"cmd":"release","surfaceId":"foreign-1","requestId":"4"}
```

The broker discovers a bound foreign HWND from Papers' existing
`Papers.WindowInstanceId.v1` property, follows native host `LOCATIONCHANGE`
events, and applies the latest known rectangles with one `DeferWindowPos` batch.
EOF on stdin restores every still-verifiable original rectangle and exits.

If compilation or launch is unavailable, Papers keeps its existing verified
PowerShell placement follower. The broker is therefore an acceleration path,
not a new failure mode for picker, persistence, or workspace hydration.
