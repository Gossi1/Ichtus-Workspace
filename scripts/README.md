# Scripts

Helper scripts for working with the Ichtus workspace. Each script is
self-contained; no installer is required to use them.

## Windows (`*.bat`)

| Script | Purpose |
|--------|---------|
| [`windows-setup.bat`](./windows-setup.bat) | Whitelist the workspace (and any nested repos) via `git config --global --add safe.directory`. Fixes *"fatal: detected dubious ownership in repository"* after restoring the workspace under a different Windows user. Idempotent — no admin needed. |
| [`windows-cleanup.bat`](./windows-cleanup.bat) | Counterpart: removes the `safe.directory` entries this workspace added. Scoped to paths inside the workspace, with a confirmation prompt and a tally of untouched entries. |

### How to run

From `cmd.exe`:

```cmd
scripts\windows-setup.bat
```

From PowerShell (same script — Windows handles the `.bat` transparently):

```powershell
.\scripts\windows-setup.bat
```

### Shell comment gotcha (PowerShell vs cmd.exe)

PowerShell treats `#` as a line comment; `cmd.exe` has no comment syntax.
`::` is the comment marker in `setup.bat` style, but **PowerShell does not
recognise `::`** and will try to execute it as a command, which makes the
console throw `CommandNotFoundException`. So:

```powershell
# NOT a comment in PowerShell → will throw
:: dit is een opmerking

# dit is WEL een comment in PowerShell
```

If you paste diagnostic commands from chat/READMEs into PowerShell, drop
any inline comments (anything after `#` or `::` on the same line), or move
them to a separate `#`-prefixed line.

## Toekomstige scripts

Volg dezelfde naamgeving: `<platform>-<actie>.<ext>`, bv.
`linux-cleanup.sh`, `macos-fix-permissions.sh`. Houd scripts lean — één
executable bestand, geen externe Node/Python dependencies.
