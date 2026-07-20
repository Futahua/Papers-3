# Papers 3 — User guide

Papers gives your work persistent places called **Backpacks**. You enter a Backpack, work
inside its programs, leave, and everything is exactly there when you come back — including
after a restart.

## Getting started

1. Install with `Papers3-Setup-<version>.exe` and launch **Papers 3**.
2. The home screen lists your Backpacks. Create one, then **Enter** it.
3. Inside a Backpack you are in the **Canvas frame**. It always shows, no matter which
   program is active: **← Leave**, the Backpack name, the program launcher, the contextual
   shelf, **Runs**, **Permissions**, the Hermes health chip, and the save-status chip.
4. Pick a program. One primary program is active at a time; its surface fills the canvas.
   Press **Escape** any time to return focus to the frame.

## Repository Research (the primary program)

Treat a real repository as research material and end with an editable report:

1. **Overview → Register repository…** — point it at a local Git repository. Papers reads it
   in place; the repository itself is not copied or modified. Only excerpts you explicitly
   capture become Papers evidence. You approve the access first.
2. **Explorer** — browse and search the repository. Open a file, click a start and end line,
   and **Capture evidence**: the excerpt is stored with path, commit, line range, and a
   content hash — its provenance is permanent.
3. **Notes / Evidence** — write linked notes, tag topics, group evidence into collections.
4. **Select things and ask** — the selection tray shows what is selected and which agent
   actions apply (explain, compare, summarize, find disagreements, map dependencies, suggest
   an outline, draft, check claims…). Every action shows you a **preview of exactly what will
   be shared** — the precise files, excerpts, hashes, any truncation, where the result will
   go — before anything is sent. Nothing is ever shared implicitly.
5. **Runs** — watch the agent work (public events only), answer approval requests, **Stop**
   a run, retry a failed one, or open the authoritative session in Hermes itself.
6. **Coding Tasks** — turn findings into a task, approve it, create a **disposable worktree**
   (the original repository is never touched), and delegate the implementation through Hermes
   to **Codex** or **OpenCode**. Inspect the diff and checks, then accept or reject.
7. **Draft Production** — assemble sections from your evidence, generate an editable
   document, and open it in **LibreOffice Writer**. Earlier drafts are always preserved.

## Visual Dashboard

A second program with a completely different look. It can only see the summary that
Repository Research explicitly publishes — and only after you approve that access. It proves
that programs are isolated: different world, same safety rules.

## Permissions

Programs have no direct access to your files, network, or machine. Every privileged request
goes through a prompt: **Allow once**, **Allow for this program**, or **Deny**. Standing
grants are listed under **Permissions** and can be revoked at any time.

## If something breaks

- A crashing program cannot take the frame down. You'll see what failed, what is intact, and
  a **Restart program** button. A program crashing repeatedly is quarantined until you clear it.
- Corrupt data files are quarantined into `PapersData/recovery/` (never deleted) and the last
  known good version is restored automatically.
- If Hermes is unavailable, the chip in the top bar says so; everything else keeps working.
- Runs interrupted by a restart are marked honestly as interrupted — retry re-submits the
  same recorded invocation.

## Your data

Everything lives in `%APPDATA%\papers3\PapersData` — plain, inspectable JSON plus your
artifacts. Uninstalling Papers does **not** delete it.

## The Logseq demonstration

To try the full workflow on a real, non-trivial repository:

```
npm run fixture:logseq   # disposable pinned checkout of logseq/logseq (AGPL-3.0)
npm run demo:seed        # creates the "Logseq Repository Lab" Backpack
```

Then launch Papers and enter **Logseq Repository Lab**. The fixture is read-only research
material: Papers never pushes to it and never copies its code. Remove everything with
`npm run fixture:logseq:cleanup`.
