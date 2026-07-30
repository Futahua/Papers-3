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
It is not inherently a project folder or a single page. Papers may contain unique and
shared Backpacks, but those words do not yet impose configuration or behavior.

### As you Go in the authorized 1.2.3 correction

After the authorized 1.2.3 update, Papers shows “As you Go” from its independent local
project on this machine. Click `Enter` to see the four prepared actions: `CLIPS`,
`SLOPTOP MODE`, `slop_engine` and `usb`. Choose an action to open its existing local
workflow.

The four actions are finished workflow interactions. There is no Add, Remove, path picker
or setup screen, and this local workflow does not define any other Backpack. Use **Copy
agent pickup prompt** beside `Local Backpack` when asking an agent to continue Papers or
Backpack work; paste it into the task and replace the final placeholder with what you want
to experience.

“As you Go” is maintained outside the Papers binary on this machine. Ordinary changes to
its interface, prompt and actions do not require a Papers update and do not affect another
machine.

## Tools

Tools is a permanent destination within Basic. Only the creator decides what is a Tool.
Its behavior has not yet been decided.

The current installed screen still contains placeholder wording that calls Tools global
and shared and lists possible examples. That wording is not an accepted Tool definition.
The mismatch is recorded in [`PROBLEMS.md`](PROBLEMS.md); this documentation correction
does not change the running interface.

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
