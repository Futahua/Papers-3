# Papers — visible behavior guide

This describes the current installed build. Verified behavior is recorded in
[`ACCEPTANCE.md`](ACCEPTANCE.md).

## Basic

Basic is always available. It opens Backpacks, Tools or Settings.

## Hermes

Open Hermes from anywhere in Papers. It is global: selecting or entering a Backpack does
not change its folder, conversation or context. Attach files and images or name paths
inside Hermes when you want to provide context.

**Hermes does not start when Papers opens.** It starts the first time you open it with one
of the two symbol toggles, and can take up to a minute that first time. This is deliberate —
Papers never forces Hermes open — so a quiet Papers with no Hermes running is working
correctly, not stalled.

## Backpacks

Click `Add Backpack` and give it a name. Nothing else is created automatically.

Until real contents have been made for it, clicking `Enter` shows:

> Nothing here yet. Create something under “Backpack name”.

A future Backpack may reach across the whole machine and contain several ways of working.
It is not a project folder or a single page.

## Tools

Tools is a permanent global destination. Tools will represent reusable capabilities such
as programs, shortcuts, scripts, automation, locations and utilities. Its exact behavior
has not yet been decided, so the first honest screen may contain no configured Tools.

## Settings

Settings opens with two cards.

**Updates** — Papers looks for a newer version shortly after it opens and downloads it in
the background. When one is ready it offers **Restart and update**. Papers never restarts
on its own, because it may be running Hermes at the time.

**This build** — which version of Papers this is, including the exact code it was built
from, the computer's name and the folders it uses. To check whether two computers are
running the same Papers, compare the middle part of the top line. **Copy build details**
puts all of it on the clipboard.

## Engineering fixtures

Repository Research, Visual Dashboard, Kill Test, ACP and Agent Runs are not product
features and are absent from normal builds.
