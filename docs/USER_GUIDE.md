# Papers 3 — user guide

## Backpacks

The opening view shows your Backpacks as visual working environments. Create one with a
name and, if useful, choose a folder and cover image. Enter it, rename it or archive it.
A Backpack does not need a canvas or saved desktop scene.

Inside a Backpack, **Choose folder** associates an optional working folder. Papers does
not scan or import that folder. **Hermes window** passes it to Hermes Desktop as the
initial working directory.

## Hermes

Hermes is available everywhere:

- **Hermes sidebar** opens Hermes Dashboard's existing chat interface inside Papers.
- **Hermes window** opens the existing native Hermes Desktop product.

Use Hermes normally: type a prompt, attach files or images in Hermes, mention paths,
receive replies and continue the conversation. Conversation history, models, settings,
tool activity and approvals are Hermes features and remain in Hermes.

Papers does not require an additional preview or structured workflow before sending a
normal prompt.

## Optional desktop environments

Papers can later associate a Backpack with an existing Microsoft PowerToys Workspaces
scene to launch and arrange applications. This is optional. Creating and using a Backpack
with Hermes never requires PowerToys.

## Test fixtures

Repository Research, Visual Dashboard and Kill Test are engineering fixtures. They are
hidden in normal builds. Developers can expose them with:

```powershell
$env:PAPERS_ENABLE_FIXTURES='1'
npm start
```
