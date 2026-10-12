# Changelog

All notable changes to `@akms/mcp-wsl`. Dates are `YYYY-MM-DD`.

## 0.1.1 — 2026-10-13

### Documentation

- Align the manual MCP client examples with `setup` by launching through `cmd /c npx`
  on Windows, and clarify the installation prerequisites.
- Add PowerShell environment examples for `--check` and the live tests. Explain how to
  check saved entries through `setup`, the `id` allow-list requirement, and check exit codes.
- Expand the release procedure to include lockfile and server-version synchronization,
  tests, build verification, CLI version output and a package preview before publishing.

## 0.1.0 — 2026-10-11

### Added

- **`akms-mcp-wsl setup`** — an interactive manager for the distros registered in an MCP
  client's config. The registered entries are the menu: pick one to edit, check, print or
  remove it. Adding or editing opens a settings form — every setting listed with its value
  (distro, user, server name, description, read-only, Windows access, file paths), picked and
  changed in any order, with Test and Save below. The distro is picked from what
  `wsl -l -v` lists, a new entry starts on the default distro, and the server name follows
  the distro and user until it is set by hand. Test runs the same check as `--check`; Save
  offers it when the values changed since the last one. Choices are arrow-key lists on a
  terminal, numbered lists without one (a pipe, Git Bash's mintty), and Esc always goes back
  one level — out of a field with the value unchanged, from the write preview back into the
  form. Text fields on a terminal are a small line editor (←/→, Home/End, Backspace/Delete,
  Ctrl+U). Targets Claude Code (user scope, through `claude mcp`), Codex
  (`~/.codex/config.toml`), Claude Desktop and Cursor; `--target <client>` picks one.
  `config` — the name `@akms/mcp-ssh` used before 0.1.3 — opens it too. Same machinery as
  `@akms/mcp-ssh setup` 0.1.3.

### Library API

- `listDistros()` returns every row of `wsl -l -v` (`WslDistroListing`, with the default
  marker); `queryDistroListing` is built on it.
- `loadHostProfile(env?)` reads from the given record instead of `process.env` when one
  is passed.

## 0.0.2 — 2026-09-28

- `package.json` declares `repository`, `homepage` and `bugs` pointing at
  `github.com/alkemic-studio/npm.akms.mcp-wsl`.
- `README_DEV.md` links `@akms/mcp-ssh` to its repository under `alkemic-studio`.

## 0.0.1 — 2026-09-28

Initial implementation. Design record: `akms.docs/mcp-wsl-design.md`.

- One server entry fronts one distro **and one user** (`WSL_DISTRO` + `WSL_USER`), declared
  as plain `WSL_*` variables — the `SSH_*` surface of `@akms/mcp-ssh` with the connection
  and authentication variables removed, because there is no connection.
- Commands run through `wsl.exe -d <distro> -u <user> --exec bash -lc <script>`. `--exec`
  rather than `--`: the latter hands the arguments to the distro's default shell for a
  second parse, which strips backslashes and expands `$VAR` before the guard's view of the
  command ever runs.
- Sessions remember a working directory only; each call is its own process.
- File tools stream through the distro process (`find` / `head -c` / `tee` / `cat`), so
  the registered user's permissions decide access — `\\wsl$\` would have used the distro's
  default user regardless.
- Guard policy is `@akms/mcp-ssh`'s, plus WSL catastrophe rules (`wsl --shutdown`,
  `poweroff`) and `WSL_ALLOW_WINDOWS` (default `false`): interop `.exe` execution and
  writes under `/mnt/<drive>/` are refused, and the operator's credential and MCP
  configuration paths under `/mnt/` are refused regardless.
