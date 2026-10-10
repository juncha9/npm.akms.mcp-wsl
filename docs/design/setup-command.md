# `setup` command — design

Status: **implemented**, 2026-10-11. Ported from `@akms/mcp-ssh`'s `setup` as of its 0.1.3
(arrow-key lists, settings form, Esc as "back"); this record covers what is shared and what
differs. `config` — mcp-ssh's name for it before 0.1.3 — is accepted as a hidden alias.

## 🎯 Problem

Registering a distro means writing an MCP server entry by hand: the right file for the
right client, the `command` / `args` shape (`cmd /c npx` on Windows), and `WSL_*` names
nobody remembers. A distro name typed as `ubuntu` when `wsl -l -q` says `Ubuntu-24.04` is
only discovered when the agent's first call fails. The client is not always Claude Code
either — Codex keeps its servers in TOML, Claude Desktop and Cursor in their own JSON files.

## ✅ Decisions

| Question | Decision |
|---|---|
| Entry point | `akms-mcp-wsl setup` — a management UI (list / add / edit / remove / check / print / switch client), as in mcp-ssh |
| Claude Code scope | **user only** (`~/.claude.json`), as in mcp-ssh |
| Choosing | arrow-key lists, not typed keywords — mcp-ssh's revision after first use |
| Add / edit | a settings form, not a question sequence — mcp-ssh's revision: one wrong answer meant walking every question again |
| Distro input | picked from `wsl -l -v`; "Another name…" types one, and an unlisted name needs an explicit yes |
| Reuse from mcp-ssh | **copied**, not imported — mcp-ssh does not export its `manage` module |
| Flags | `--target <client>` only |

## 🧭 Flow

```
setup [--target <client>]
 └─ loop: the entries in the current client's file ARE the menu
     ├─ <entry>          → Edit / Check the distro / Print the entry / Remove / Back
     │    ├─ Edit        the settings form, pre-filled → preview → write;
     │    │              a rename writes the new name, then removes the old
     │    ├─ Check       the stored entry through loadHostProfile, then `id` in the distro
     │    ├─ Print       JSON + TOML + claude CLI line
     │    └─ Remove      confirm (default No)
     ├─ Add a distro     the settings form → preview → write
     ├─ Switch client    claude-code / codex / claude-desktop / cursor
     └─ Quit             (Esc, Ctrl+C, Ctrl+D and a script running out also quit)
```

**The settings form.** Every setting is a row with its value:

```
? New distro entry
❯ Distro          Ubuntu
  User            distro default  the Linux user commands run as
  Server name     wsl_ubuntu      follows the distro and user until you change it
  Description     none            shown to the agent
  Read-only       no              enter toggles
  Windows access  locked          enter toggles · .exe through interop, writes under /mnt/<drive>/
  File paths      anywhere        where the file tools may read and write
  ────────────────────────
  Test the distro  runs 'id' as the user · starts a stopped distro
  Save             to Claude Code (user scope)
  Cancel
```

- Picking a row edits that setting and returns to the form. The cursor then moves to the
  next row, so Enter down the list fills the form in order; a toggle keeps the cursor.
- Unlike mcp-ssh's form, no row appears or disappears: WSL has no setting a choice brings
  with it (SSH's private key, jump host), so there is nothing to hide and nothing to drop on
  Save.
- A new entry starts on the `*` distro, so Save alone writes a complete entry. With nothing
  listed, Distro shows `(required)` and Save moves the cursor to it.
- The server name follows the distro and user until it is edited by hand.
- Save settles a name clash, then offers a test if the values changed since the last
  successful one. A failed test offers Back to the settings / Save anyway / Discard.
- Cancel or Esc leaves at once from an untouched form, and asks first from a changed one.
- **Esc inside anything a row opened goes back to the form with that setting unchanged**,
  cursor on the row. Every prompt throws `PromptBackError` on Esc and the form catches it.
  mcp-ssh also snapshots the form before each pick and restores it, because its route choice
  opens the jump-host question *after* the route is set. No WSL setting asks a follow-up after
  assigning — every editor assigns only once its prompt is answered — so this form catches
  without restoring. A setting that ever does needs the snapshot.
- Esc at the write preview reopens the form on the same values. Esc at a confirmation in the
  entry menu (remove it?) goes back to the list.
- On a TTY the form redraws in place (`Prompter.transient`).

In a text field Enter keeps the value shown and `-` clears an optional one.

**Text fields run in raw mode too.** A cooked-mode read never reports Esc — the terminal
either eats it or hands the `ESC` byte over inside the value (mcp-ssh once stored a host as
`\u001b` that way). On a TTY a text field is a small line editor (insert, Backspace/Delete,
←/→, Home/End, Ctrl+U), and Esc is a key the program sees.

**Two input modes**, both from one `Prompter`: on a TTY ↑/↓, 1–9, Enter and Esc, with every
answered prompt collapsed to one `✔ question · answer` line; off a TTY (a pipe, the tests,
Git Bash's mintty) the same list is numbered and answered by number, key or label, and a line
of just `ESC` stands for the Esc key so the scripted tests can press it. No prompt library —
see mcp-ssh's record for why.

## 🔧 Rules

- **Defaults are not written.** No user (the distro default), read-only off, Windows locked
  — the entry reads like the README examples. `WSL_DISTRO` alone is a valid entry.
- **The form owns six variables**: `WSL_DISTRO`, `WSL_USER`, `WSL_DESCRIPTION`,
  `WSL_READONLY`, `WSL_ALLOW_WINDOWS`, `WSL_ALLOWED_PATHS`. Everything else under `WSL_*`
  (`WSL_NAME`, `WSL_CWD`, `WSL_ALLOW_SUDO`, allow-lists, timeouts) is carried through an
  edit untouched.
- **The distro is written as wsl.exe spells it.** Matching is case-insensitive, like
  `wsl -d`; the stored name is the listed one. A stored name no longer listed stays offered
  as "current".
- **Server names are `[A-Za-z0-9_-]{1,48}`.** The default `wsl_<distro>_<user>` follows the
  README's naming — the user belongs in the name, because the agent sees nothing else.
- **Windows access starts locked**, for the server's own reason: Windows holds the config
  that defines this guard.
- **The check is the server's own startup path.** The built env goes through
  `loadHostProfile(env)` and the report `--check` prints, so a value the server would reject
  is caught before writing, and a distro that passes setup passes `--check`. It runs `id`,
  which starts a stopped distro — the Test row and the Save prompt say so.
- **No secrets, no pinning.** Nothing in a WSL entry is secret and nothing connects, so the
  preview is not masked and there is no host key to pin.
- **Entries launch through `cmd /c npx -y @akms/mcp-wsl`** — the package is win32-only.

## 🗂️ Targets

Identical to mcp-ssh, minus the macOS / Linux paths:

| Target | File | Write method |
|---|---|---|
| `claude-code` | `~/.claude.json` | delegated to `claude mcp add-json … -s user` / `claude mcp remove`; read directly |
| `codex` | `~/.codex/config.toml` | section-level text rewrite |
| `claude-desktop` | `%APPDATA%\Claude\claude_desktop_config.json` | JSON merge |
| `cursor` | `~/.cursor/mcp.json` | JSON merge |

The rationale for each method (why Claude Code is delegated, how `claude.cmd` is escaped,
what the TOML rewrite keeps) is in mcp-ssh's `docs/design/setup-command.md`; the code is
the same.

## 🏗️ Code

```
src/modules/manage/
├── index.ts             runConfigCommand() — the entry menu, check/print/remove, preview + write  (adapted)
├── host-form.ts         the WSL settings form; distro picker; test                                 (new)
├── prompter.ts          select / text / secret prompts over any stream pair                        (copied)
├── entry.ts             answers ⇄ entry, isOurEntry, menu summary                                  (new)
├── connection-check.ts  runDistroCheck — the report shared with --check; env → profile             (moved from cli.ts)
└── targets/             claude-code, codex (+ toml-subset), json-file, registry                    (copied)
```

`listDistros()` in `modules/wsl/wsl-status.ts` reads every `wsl -l -v` row;
`queryDistroListing` is built on it.

## 🧪 Tests

| File | Covers |
|---|---|
| `manage-entry.test.ts` | defaults omitted, carried variables, round trip, `loadHostProfile(env)` contract, a value the server would refuse |
| `manage-toml.test.ts` | parse, append, replace keeping hand-added keys and sub-tables, remove, CRLF, idempotence |
| `manage-command.test.ts` | the whole UI over scripted stdin with an injected distro list and a temp JSON file: the form (default distro, any order, cursor advance, name following, toggles, unlisted distro, required distro, discard confirm, failed test, name clash, Esc in a field and at the preview), rename, clearing the user, check of a stored entry, print, remove, Esc at a confirmation and at the main menu, unreadable file, wsl.exe unavailable |
| `manage-prompter.test.ts` | arrow-key select on a simulated TTY, answer collapsing, unechoed secrets, Esc as `PromptBackError` from every prompt (and an `ESC` line off a TTY), the line editor, numbered fallback |
| `manage-cli-shim.test.ts` | Windows only — a JSON payload through npm's `.cmd` template, byte for byte |

The failing-check cases run the real `wsl -l -v` against a name that is not installed;
one live case (`MCP_WSL_TEST_DISTRO`) tests a real distro from the form and writes it.

Not covered by tests: the real `claude mcp` CLI writing `~/.claude.json`, and raw-mode
rendering on a real terminal.
