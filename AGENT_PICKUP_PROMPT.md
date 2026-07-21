# Pickup prompt — finish Papers for first use

Use this prompt with a capable coding agent running locally on the creator's Windows
machine. Local execution is required because final acceptance uses the installed Hermes,
PowerToys, file pickers, Electron views and packaged application.

```text
Continue Papers 3 in D:\Letters\MatTroiSeConMoc\PAPERS 3\Papers-3 on the existing
agent/implement-papers3-v1 branch and draft PR #3.

Your objective is to deliver the installed, creator-usable first-Backpack release—not a
prototype, framework, plan, or engineering demonstration. Read every current repository
document before changing code, especially PAPERS_3_IMPLEMENTATION_PLAN.md, then execute
that plan completely through release acceptance. Treat that file and the creator's
feedback as authoritative over older code and evidence.

The product boundary is strict:
- Backpacks are visual working contexts and work without PowerToys, scenes, canvases,
  programs or conversations.
- Hermes is the AI product. Use the installed Hermes Dashboard `/chat` and Hermes Desktop
  wholesale. Do not build chat, attachments, history, settings, permissions, run UI,
  invocation validation, context inspectors or agent orchestration in Papers.
- The normal workflow is create Backpack → enter → prompt Hermes → optionally attach a
  file/image → receive reply. A Backpack folder is optional and is passed to Hermes
  Desktop via `--cwd`.
- PowerToys Workspaces is an optional post-release enhancement. Never block first use on
  it. If integrated, read its existing data read-only and launch its official executable;
  do not implement window management.
- Historical programs and ACP infrastructure are fixtures only and must be invisible
  unless PAPERS_ENABLE_FIXTURES=1.

Work autonomously and persistently. Inspect the current implementation, reuse existing
open-source or installed products when they genuinely shorten the path, and make all
normal implementation decisions yourself. Do not stop at a partial milestone, ask the
non-coder creator to review source, or claim readiness from unit tests alone. Do not
replace the task with further planning. Preserve unrelated creator data and never test
destructive file modification on real creator files.

Finish the entire first-release path described in PAPERS_3_IMPLEMENTATION_PLAN.md:
- compact first-Backpack creation with required name, optional folder and optional cover;
- genuinely visual gallery and entered Backpack without placeholder text;
- real universal Hermes sidebar, automatically visible on first entry and remembered;
- real Hermes Desktop pop-out receiving the Backpack folder;
- safe Open folder behavior;
- clear missing-Hermes recovery;
- real icon, product metadata, packaging and installation;
- automated regression coverage plus manual human-visible validation at common display
  scales;
- real Hermes prompt/reply, attachment, and disposable-file modification evidence;
- non-technical usage documentation and screenshots.

You may refactor or delete obsolete production-facing code when that reduces complexity,
but retain the explicitly gated fixture regressions unless they materially obstruct the
release. Prefer the smallest dependable implementation. No new abstraction is a
deliverable.

Run all relevant type, unit, build, product E2E, packaged-app and fixture checks. Install
and walk through the packaged build on this machine. Fix every problem you encounter in
the primary workflow. Record honest evidence and remaining non-blocking limitations.

When the release acceptance list passes, explicitly stage only your intended changes,
commit them, push the existing branch, and update draft PR #3 with the final visible
outcome, validation and any remaining optional work. Leave the worktree clean. Your final
response must tell the creator, in non-technical language, exactly how to launch Papers
and create the first Backpack; include the installer path and screenshots. Do not call it
finished if any required acceptance step remains.
```
