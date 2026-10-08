# Papers — visible behavior guide

This describes the current installed build. Verified behavior is recorded in
[`ACCEPTANCE.md`](ACCEPTANCE.md).

## Basic

Basic is always available. It opens Backpacks or Settings.

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

If Papers closes while you are inside a Backpack, reopening Papers returns to that
Backpack. Choose **Back to Papers** when you want the next launch to begin at the
Backpack list. A Backpack with richer internal working state remains responsible for
restoring that state itself.

## Pencilcase

Open the Pencilcase Backpack to see the creator's tool list, availability, live usage
and supported startup/warm settings. LibreOffice can load in the background at Papers
startup and retain a clean ready engine. Unsupported runtime controls are unavailable.
Record live usage explicitly and stop with the same button; Show file reveals a saved
recording. Tool management belongs to Pencilcase rather than a built-in Tools pane.

## Settings

Settings opens with two cards.

**This build** — which version of Papers this is, including the exact code it was built
from, the computer's name and the folders it uses. To check whether two computers are
running the same Papers, compare the middle part of the top line. **Copy build details**
puts all of it on the clipboard.

## Engineering fixtures

Repository Research, Visual Dashboard, Kill Test, ACP and Agent Runs are not product
features and are absent from normal builds.

Pencilcase also owns the ChatGPT local coder view, opened from its dedicated tool
entry as a separate page. The Delegate Wave Backpack is retired and archived. Its
existing companion service remains the operational owner; Papers transfers the
single trusted relay binding to Pencilcase. No second agent manager is introduced.
