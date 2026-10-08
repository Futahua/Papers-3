# Native window tabs — 8 October 2026

The right strip groups real top-level application windows. Chrome keeps its own
browser tab UI and personal profile. The obsolete Papers fill-tab control is removed.

AYG owns strip presentation and invokes the existing native window candidate picker.
Papers resolves issued window bindings through windowCapabilityService before attaching;
pages cannot supply HWND/PID. ChromePaneHost owns retained WindowSessions, visibility,
native geometry and group activation. The selected peer supplies the native left edge.
Inactive peers are hidden. Release restores the original placement rather than closing
an application. Retained tabs are runtime state for this Papers session, not saved
application sessions or a duplicate authored window registry.

Crash recovery atomically records every retained peer plus the original host region.
The guardian rereads the latest record after helper termination. Personal profiles,
credentials, application documents and unsaved work remain owned by their applications.

WindowTabs and UnitedSets were inspected in local reference clones. Their complete
window-group lifecycles would compete with the existing peer host; this implementation
reuses our WindowSession machinery and existing binding/picker instead.

Validation: TypeScript; 30 bridge/file-capability tests; 1,940 existing AYG tests plus
three new strip tests; compiled Win32 fixture covering retained peers, selection,
recovery membership, detachment and release; existing native edge/fullscreen fixture.
Hands-on behavior of each external application still depends on its native UI.

## Tab switch correction — 8 October 2026

A manual strip choice holds the current workspace selection signature. Repeated
selection messages from rerendering cannot reopen a previous link/file; choosing a
different workspace item ends that hold. Tab clicks wait for the previous inline
editor to release placement, and superseded clicks cannot send a late selection.
The native host positions a retained peer before showing it, without toggling the
old peer's visibility during renderer preparation. Native maximize/F11 remains
available after selection. Tests cover unchanged and changed selections plus delayed
preview release and rapid successive tab choices.

## Strip picker and widget copies

The strip uses the shared pointer glyph, 200ms list hover dwell, and native list
shell with its own membership rows. Current rows mean Remove from the strip;
that action releases a WindowSession and never closes an application or removes
a widget member. The widget's list and authored membership remain unchanged.

Widget icons can carry an exact windowInstanceId as a copy-only drag. The strip
selects an already retained identity; otherwise it finds and binds that exact
live candidate before attaching. Raw HWND/PID never cross this drag seam. The
main host enriches retained peers using the existing capability service's observed
identities, then removes private handles from page messages. Synthetic Remove
rows retain hidden members absent from ordinary desktop enumeration. Same-title
windows remain separate. Ctrl reorder remains a widget operation.

Direct navigator file previews hold against repeated unchanged canvas selection,
so an empty canvas rerender cannot automatically reopen Chrome over a file.
