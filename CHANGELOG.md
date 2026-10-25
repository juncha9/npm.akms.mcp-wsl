# Changelog

All notable changes to `@akms/mcp-wsl`. Dates are `YYYY-MM-DD`.

## [0.3.1] - 2026-10-26

### Changed

- Require `@akms/mcp-ssh` ^0.3.1. Its local transfer guard blocks the AKMS catalog (`registry.json`, `registry.previous.json`) in `wsl_upload` and `wsl_download`; the earlier 0.1.9 dependency did not.

### Verification

- Stabilize Windows test cleanup: temporary test directories are removed with one bounded asynchronous retry budget for transient file locks, while persistent errors still fail. Tests only.
- 0.3.0 was committed but never published to npm; 0.3.1 is the first published 0.3 release.

## [0.3.0] - 2026-10-26

- Detect older registry formats in standalone config and the helper menu. Add reviewed, ordered migrations with default-No approval, script APIs, complete pre-migration backup, rollback preservation and post-apply startup checks. Runtime can change the default for future kinds without changing existing modes.

- Start new registries in version 2 session mode. Register/Add/Import create per-kind bundles automatically; missing runtimes keep imported legacy entries until installation and Sync. Existing v1 migration and v2 per-kind rollback choices are preserved.

- Add session servers (default for new catalogs, opt-in migration for existing version 1 catalogs): one direct-Node `akms_<kind>` entry per client session, connection-prefixed tools, registry version 2, reviewed migration and rollback, and startup tool coverage checks.
- Preserve one atomic `registry.previous.json` revision per catalog-changing operation; keep externally edited client entries for Sync and retain old entries until replacements are verified.
- Validate connection-name budgets; document credential location and recovery in session mode. Show runtime paths in startup failures, accept string protocol versions, and explain file-lock update failures.

- Check MCP startup after saves, runtime conversion and Updates; add an on-demand Updates screen and default registration removal to No.

- Document plaintext catalog credentials, platform permissions, transfer-guard limits and recovery; show one privacy notice during Register review and a catalog notice in --help.
- Keep custom-command edits and host-key saves independent of the managed runtime; continue with a still-usable installed runtime after an update failure.

- Install managed server runtimes under `<AKMS_MCP_HOME or ~/.akms/mcp>/runtime`, independent of Node versions. Convert existing npx and global paths through Runtime; preserve development links.
- Offer older-runtime updates before Add/Edit and check installation before host-key saves. Include the last npm error lines without ANSI controls, and recognize Unix npm JavaScript paths while skipping version-manager shims.

- Generate direct Node launches using the dedicated runtime installation instead of npx. Install the latest runtime on first Add/Edit when missing; reuse installed versions with update prompts when the setup package is newer. Runtime converts existing standard entries together, preserving connection values, custom commands and external edits; linked development packages are protected.

- Clarify Sync choices with numbered AKMS/service versions, highlighted differences, wrapped values, and explicit apply destinations.

- Separate terminal menu, comparison and result screens; wait for acknowledgement before returning, while keeping piped commands unchanged.

- Keep all configuration menus visible; Add requires at least one registered AI service.
- Summarize registration/sync results, show only differing fields during review, and distinguish pending imports from shared settings conflicts.

### Changed

- Discover earlier client settings before registration, merge matching sync copies on Apply, and preserve differing versions for review.
- Add standalone `register` and `sync` commands and a persistent shared connection catalog. Save once to apply a connection to all registered AI services without installing `@akms/mcp`.
- Import existing client entries with explicit conflict choices; preserve external edits, retry partial failures and retain old names until renames succeed. Honor `CODEX_HOME`.

## 0.2.1 — 2026-10-19

### Documentation

- Add a minimum distro-only configuration example to README, with Windows prerequisites and default-user behavior.

## 0.2.0 — 2026-10-19

### Changed

- Align the package, CLI and MCP server versions with the 0.2.0 MCP release family.
- Accept `@akms/mcp-ssh` 0.2.x as well as compatible 0.1 releases starting at 0.1.9. Keep the verified, published 0.1.9 dependency locked so the checkout remains installable before the SSH 0.2.0 release is published.

## 0.1.6 — 2026-10-19

### Changed

- Require `@akms/mcp-ssh` 0.1.9 or later within the 0.1 series. Its lazy SSH runtime loading keeps `ssh2` and its crypto runtime out of WSL startup and command execution while retaining the shared command/path guards.
- Document the distinction between MCP process memory, session state and the WSL virtual machine. Command execution, session expiry and distro lifecycle are unchanged.
- Add fresh-process regression coverage verifying that guard rejections prevent process creation and that successful command output and working-directory tracking do not load `ssh2`, using a local process fixture without starting a distro.

## 0.1.5 — 2026-10-19

### Added

- Add **Copy to another client** to each saved entry's config menu. Choose Claude Code,
  Codex, Claude Desktop or Cursor to copy its name, command, arguments and complete
  environment without changing the source or switching the current client.
- Ask before overwriting any same-name destination entry, including another package or
  HTTP transport. The default is No; Esc returns to the destination picker.

### Fixed

- Validate complete TOML before and after edits. Recognize inline/dotted server names,
  quoted keys and multiline values; refuse layouts that cannot be edited without
  changing unrelated settings. Preserve all string environment values when copying.
- Write JSON and TOML configs through a flushed temporary file and a single rename.
  Partial writes and failed commits keep the original; concurrent changes observed
  before committing abort the save. New config files use owner-only permissions.
- Detect destination names even when the entry cannot be listed as a stdio server.
  Reject malformed JSON server maps instead of replacing their contents.
- Replace the complete destination Codex server table when copying, removing stale
  transport options while keeping unrelated settings. Ordinary edits still preserve
  hand-written options.
- Restore the complete previous Claude Code entry if its replacement fails, and report
  recovery failures accurately. Missing-CLI messages no longer print credentials.

### Documentation

- Document the copy menu, overwrite confirmation and copied fields in the README.

### Verification

- Cover cross-client copying, name conflicts, cancellation, EOF, unreadable destinations,
  source preservation, TOML replacement and Claude Code CLI rollback.
- Reproduce multiline-string corruption, missed inline-name collisions, lost env keys,
  partial disk writes, failed renames and concurrent file changes.

## 0.1.4 — 2026-10-19

### Fixed

- Keep connection check results visible in interactive `config` until Enter is pressed,
  instead of immediately redrawing the menu and scrolling the report out of view.
  Esc goes back and Ctrl+C exits; scripted input needs no additional answer.

### Added

- Animate checks in `config` and `--check` with a spinner and elapsed time for each phase:
  distribution discovery, startup and user verification, and distribution information.
  Completed phases remain visible with success or failure markers and colors.
- Fit progress lines to the terminal width, use ASCII on legacy Windows consoles, and
  respect `NO_COLOR`. Redirected output and `TERM=dumb` keep plain reports.

### Documentation

- Include `CHANGELOG.md` in the npm package and document the check display in the README.

### Verification

- Cover report pauses, cancellation, progress timing and cleanup, narrow terminals, and
  phase transitions on successful and failed checks.

## 0.1.3 — 2026-10-13

### Fixed

- Never stay behind when the MCP client dies. The first log line written after stdin ends goes to
  a stderr nobody reads; that EPIPE is now absorbed once and logging stops for good, instead of
  being logged again (the loop that kept `@akms/mcp-db` 0.1.1 alive at 100% CPU). Shutdown also
  has a 5 s deadline (`SHUTDOWN_DEADLINE_MS`) after which the process exits regardless.
- Keep the server running through an uncaught exception or unhandled rejection raised by one
  session instead of taking every tool of the client down; both are logged.

### Changed

- The `mcp server ready on stdio` log line carries the process `pid`.

### Verification

- Add `tests/cli-shutdown.test.ts`: starts the server through `cmd /c` the way Claude Code does
  on Windows, completes the handshake, lets the client die, and expects the server gone within 5 s.

## 0.1.2 — 2026-10-13

### Changed

- **Breaking:** Use `akms-mcp-wsl config` as the only configuration command. The former
  `setup` command now exits with code 1 and a reminder to use `config`.
- Align CLI help, usage examples and developer documentation with `config`.

### Verification

- Add CLI regression tests for help, `config --target codex`, rejecting `setup`, and
  the `--check` guidance when no distro is configured. Tests use temporary client settings.

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
