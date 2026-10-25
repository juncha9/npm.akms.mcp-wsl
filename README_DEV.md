# Development

## Release guard and package order

Run `npm run prepublishOnly` to inspect every publish prerequisite without publishing. `npm publish` runs the same `node scripts/release-guard.mjs` gate. It requires a clean `git status --porcelain`, a package version newer than the configured registry's `latest`, matching `SERVER_VERSION` (servers only), and five registration copies matching the DB baseline. Metadata uses a fresh temporary cache. Any lookup failure, including E404, or a missing `latest` tag blocks release. All five sibling checkouts are needed for release comparison; normal builds and installed packages do not need them.

The DB registration directory is the baseline. Run `node scripts/sync-registration.mjs` from the DB checkout after common changes. The launcher keeps its own adapters and its `prompter.ts` import is adjusted for `launcher/prompter`. Keep the five development-only `scripts/release-guard.mjs` copies identical.

Release in this order:

1. Publish `@akms/mcp-ssh` with AKMS registry protection first, after its tests, build, package inspection, reviewed commit and release gate pass.
2. Raise `@akms/mcp-wsl`'s SSH dependency minimum to that published protected release, remove ranges permitting SSH 0.1.9, and refresh its lockfile and local dependency. WSL's release gate calls the installed SSH guard against `.akms/mcp` reads and writes; the current SSH 0.1.9 must fail, regardless of the WSL version.
3. Validate and publish WSL, then the DB and S3 servers. Align each manifest, lockfile and `SERVER_VERSION`, synchronize registration, and commit reviewed release changes before running the gate.
4. Publish the optional `@akms/mcp` launcher last, once every child can be installed from npm.

The guard never commits, installs dependencies or publishes. `npm pack --dry-run` inspects contents without invoking this publish-only gate.

Sibling of [`@akms/mcp-ssh`](https://github.com/alkemic-studio/npm.akms.mcp-ssh) — same layout, same build, same tool surface with `ssh_` → `wsl_`. The design record with the measurements behind each decision is `akms.docs/mcp-wsl-design.md`.

## 🧑‍💻 Commands

Run from Windows PowerShell at the repository root:

```powershell
npm ci                   # install the locked dependencies
npm run dev -- --check   # tsx, straight from src
npm run dev -- config     # the distro manager, against this machine's real client configs
npm run build            # tsc --noEmit → tsup (esm + cjs + dts into lib/)
npm test                 # vitest; live cases require MCP_WSL_TEST_DISTRO
```

`--check` needs `WSL_DISTRO` (and optionally `WSL_USER`) in the current shell; see the [PowerShell example](README.md#check-it-before-wiring-it-up). The live-test variables below are separate from those server settings.

## 🗂️ Layout

```
src/
├── _defs/       constants, WSL rule tables, env var names
├── _types/      config / wsl types (compile-time only)
├── _libs/       stderr logger, text + path helpers
├── modules/
│   ├── config/  WSL_* readers, profile builder
│   ├── guard/   the WSL additions over @akms/mcp-ssh's guard
│   ├── manage/  the `config` command: prompts, settings form, per-client config writers
│   ├── wsl/     wsl.exe process runner, session manager, file operations, distro status
│   └── tools/   MCP tool registration, output formatting
├── server.ts    createWslMcpServer()
├── cli.ts       bin entry (stdio transport, --check, config)
└── index.ts     library entry
```

## 🏗️ Design decisions

### What is reused from @akms/mcp-ssh and what is not

Reused as a dependency: `inspectCommand`, `inspectRemotePath`, `inspectLocalPath`, `inspectWorkingDirectory`, `canonicalizeCommand`, the segment analysis helpers, `GuardRejectionError`, and the `SshPolicy` type (as `WslPolicy`, with `connectTimeoutMs` carried as 0). Two servers that refuse different things would need two sets of agent instructions.

Re-implemented: the `cd` wrapper and `$PWD` marker (not exported by mcp-ssh), the logger (its own env var), the text helpers. Written fresh: everything that touched ssh2.

Since WSL 0.3.1, the dependency requires `@akms/mcp-ssh` ^0.3.1, the first release whose local transfer guard blocks the AKMS catalog; the lockfile pins the published 0.3.1. WSL 0.1.6–0.2.x accepted SSH >=0.1.9. That package loads `ssh2` only when an SSH connection is opened, so reusing its guards no longer initializes the SSH/crypto runtime. The guard implementation stays shared. `tests/startup-loading.test.ts` checks a fresh process before and after guard checks and command execution, substituting a Node process for `wsl.exe` so the test never starts a distro.

On Windows with Node 24.19.0, three fresh built-library processes per version measured median Private Bytes of 47.92 → 44.88 MiB and RSS of 79.74 → 73.21 MiB after constructing a configured server. The comparison used SSH dependency 0.0.2 versus 0.1.9, with no WSL commands or npm wrapper. These are local startup samples, not a fixed memory budget or a measurement of WSL VM memory. The `ssh2` module was loaded in every old sample and absent in every new sample.

### `--exec`, measured

Probing `wsl.exe` on 2026-09-28 gave the rules the runner is built on:

| | `-- bash -lc SCRIPT` | `--exec bash -lc SCRIPT` |
|---|---|---|
| `'x\y'` | `xy` | `x\y` |
| `"$HOME"` | expanded **before** bash ran | reaches bash as written |
| login shell | yes | yes (`bash -l`) |

`--` is the distro's default shell re-parsing the arguments. `--exec` is execve. Only the second lets the guard's view of the command be the command that runs.

Also measured: `--cd /missing` exits **0** and runs in `/` with a warning on stderr — so `cd` is done inside the script, where a missing directory exits 1. An unknown distro exits `4294967295` with the reason on **stdout** (localised); `WSL_UTF8=1` makes that stdout UTF-8 instead of UTF-16. `sudo -n` without `NOPASSWD` fails in milliseconds. A background job whose descriptors stay attached holds `wsl.exe` open; `nohup … > log 2>&1 < /dev/null &` returns in 100 ms.

### Guards live at the chokepoint

`WslHost.exec` screens every command; the file operations screen every path. Tool handlers never call a guard directly, so a new tool cannot forget to.

### The one default that differs: `WSL_ALLOW_WINDOWS`

mcp-ssh is permissive by default because a guard that blocks real work gets switched off wholesale. That still holds here — except for the two routes that leave the distro for Windows, because in WSL the machine on the other side is the one running this server, and the MCP configuration that defines the guard sits on its filesystem. Locking those two routes by default costs almost nothing (reads under `/mnt` stay open, so "deploy the file I built on Windows" works) and removes the one way a mistaken agent could rewrite its own policy.

The `/mnt` write rule judges the write **target**, not the mention: `cp /mnt/c/app/dist.tgz /home/app/` is a read of the mount and passes; `cp /home/app/out.log /mnt/c/Users/me/Desktop/` is refused. Per binary shape: copy-likes write their last operand, `tar` writes when creating, `curl -o` / `unzip -d` / `tar -C` write where the option points, every other write-shaped binary writes each operand, and a redirection is a target for any binary.

### Sessions are a remembered directory

Each call is its own process, so there is nothing to keep open. A session serializes its calls (the directory is read-modify-write) and adopts the `$PWD` the marker reports, after the same metacharacter check a caller-supplied `cwd` gets.

### `config` is mcp-ssh's manager with a WSL form

`@akms/mcp-ssh` does not export its `config` machinery, so the client-agnostic half is copied: `prompter.ts` (arrow-key lists and a raw-mode line editor on a TTY, so Esc is seen everywhere; numbered lists off one), `targets/` (Claude Code through `claude mcp`, Codex by TOML section rewrite, plain `mcpServers` JSON files) and the menu loop. The package is win32-only; managed entries start Node directly using the dedicated AKMS runtime installation. A fix to one of those files almost certainly belongs in both packages.

Written fresh: the settings form (`host-form.ts`) and the entry mapping. There is no connection, so the SSH settings (port, auth, route) and host-key pinning are gone, and so are the rows a choice brings with it — every WSL row is always shown. The distro is picked from `listDistros()` — the `wsl -l -v` rows, matched case-insensitively and written as wsl.exe spells it — and a typed name that is not listed needs an explicit yes. A new entry starts on the default distro, so Save alone writes a complete entry. `WSL_ALLOW_WINDOWS` starts locked, for the reason the server defaults it off.

Esc inside a field returns to the form with the cursor on that row. mcp-ssh's form snapshots and restores its state around every pick, because a route choice opens a jump-host question after the route is already set; no WSL setting does that — every editor assigns only once its prompt is answered — so this form has no snapshot to restore. A setting that ever asks a follow-up after assigning needs one.

The check is the server's own path: the entry about to be written goes through `loadHostProfile(env)` and the same `runDistroCheck` report `--check` prints, so a value the server would reject is caught before it is written. Running `id` starts a stopped distro, which is why the Test row and the Save prompt say so. Full rules and rationale are in [docs/design/setup-command.md](docs/design/setup-command.md).

### A dead stderr is never a reason to stay

When the MCP client dies, every pipe the server holds dies with it. stdin's EOF starts the shutdown, and
the first log line of that shutdown goes to a stderr nobody reads: on Windows the write fails
asynchronously with EPIPE as an `'error'` event on `process.stderr`. The logger owns one listener for
that event and drops every later line (`stderrBroken`), so the failure is never logged — logging it
was the loop that kept `@akms/mcp-db` 0.1.1 behind at 100% CPU, measured 2026-10-13 under Claude
Code's `cmd /c` launch. Here the exit used to win the race because `shutdown()` is synchronous; the
guard removes the race, the `uncaughtException` handler keeps one session's stray error from ending the
client's whole tool set, and `SHUTDOWN_DEADLINE_MS` (5 s) exits regardless of what the transport or a
stuck `wsl.exe` still owes. `tests/cli-shutdown.test.ts` starts the server the way Claude Code does and
expects it gone within 5 s of the client's death.

## 🧪 Testing

| File | Covers |
|---|---|
| `wsl-guard.test.ts` | WSL catastrophe rules, interop, `/mnt` write targets vs reads, operator paths through the mount, path guard |
| `host-profile.test.ts` | `WSL_*` mapping, defaults, malformed values |
| `wsl-command.test.ts` | Argument vector (`--exec`), `cd` wrapper, cwd marker |
| `live-integration.test.ts` | **MCP client ↔ server ↔ real distro** over an in-memory transport: exit codes, argument bytes, UTF-8, closed stdin, bad cwd, session `cd`, timeout, guard rejections proving nothing ran, file round-trips including binary upload/download, unknown distro |
| `cli-command.test.ts` | CLI help, `config --target`, rejecting `setup`, and unconfigured `--check` guidance |
| `manage-entry.test.ts` | `config` answers ⇄ entry, carried variables, the `loadHostProfile(env)` contract |
| `manage-toml.test.ts` | Codex TOML: append, replace keeping hand-added keys, remove, CRLF |
| `manage-command.test.ts` | **The `config` UI end to end** — the menu and the settings form over scripted stdin, an injected distro list, a temp JSON config; the failing checks run the real `wsl -l -v` against a name that is not installed |
| `manage-prompter.test.ts` | Arrow-key lists, the line editor, secret input and Esc as "back" on a simulated TTY; the numbered fallback off one |
| `manage-cli-shim.test.ts` | Windows only — a JSON payload through npm's `.cmd` shim template, byte for byte |

The live file, and the one live case in `manage-command.test.ts`, are skipped unless `MCP_WSL_TEST_DISTRO` names an installed distro on a Windows machine. The live file creates and removes `/tmp/akms-mcp-wsl-test-<pid>` in that distro.

To include them, choose a distro from `wsl -l -v` and an existing Linux user (`MCP_WSL_TEST_USER` defaults to `root`):

```powershell
$env:MCP_WSL_TEST_DISTRO = "Ubuntu"
$env:MCP_WSL_TEST_USER = "root"
npm test
```

Unset the variables when returning to the default test run:

```powershell
Remove-Item Env:MCP_WSL_TEST_DISTRO, Env:MCP_WSL_TEST_USER -ErrorAction SilentlyContinue
```

## 📚 Embedding as a library

```typescript
import { createWslMcpServer } from "@akms/mcp-wsl";

const instance = createWslMcpServer();      // reads WSL_* from this process's environment
await instance.server.connect(myTransport);
instance.shutdown();
```

`WslHost`, `inspectWslCommand`, `inspectWslPath`, `loadHostProfile` and `registerAllTools` are importable on their own.

## 📦 Releasing

Version **0.1.2** removes the `setup` command; existing setup invocations must change to
`config`. The CLI regression suite verifies the transition using temporary client settings.

Keep `package.json`, both root-package versions in `package-lock.json`, and `SERVER_VERSION` in `src/_defs/defaults.ts` in sync. The constant is used by the CLI's `--version` output and the MCP server handshake.

1. Run `npm version patch --no-git-tag-version` (or choose `minor` / `major`) to update the manifest and lockfile without creating a commit or tag.
2. Set `SERVER_VERSION` to the same version and add a dated entry to `CHANGELOG.md`. Update the usage and development docs for the changes being released.
3. Run each check below and confirm it succeeds before publishing. Include the live tests above when validating WSL behavior.

```powershell
npm test
npm run build
node ./lib/cli.js --version
npm pack --dry-run
```

Check that the CLI prints the release version and the package preview contains the built `lib/` files, `README.md`, `CHANGELOG.md` and `LICENSE.md`. After reviewing the changes and package contents, publish with `npm publish`.

When an SSH guard change matters to WSL, publish that `@akms/mcp-ssh` version first, then raise WSL's dependency minimum to it and refresh the lockfile. 0.3.1 did this for the catalog guard (`^0.3.1`).

## Registration code

The local `src/modules/registration` copy is bundled into this package. It needs no launcher or sibling checkout at build or runtime. The sibling DB checkout maintains the shared files; its `node scripts/sync-registration.mjs` command updates development copies. Keep schema version 1 compatible across releases and test standalone registration before publishing.

## Link the development runtime

The server installation is independent of the active Node version: `<AKMS_MCP_HOME or ~/.akms/mcp>/runtime`. After building the checkout, use npm's global layout with this explicit prefix; a plain `npm link` in the default Node prefix is not discovered as the managed runtime.

From this checkout in PowerShell:

```powershell
npm run build
$akmsRuntime = if ($env:AKMS_MCP_HOME) { Join-Path $env:AKMS_MCP_HOME "runtime" } else { Join-Path $env:USERPROFILE ".akms/mcp/runtime" }
npm install --global --prefix $akmsRuntime .
node lib/cli.js config
```

For macOS/Linux, use `npm install --global --prefix "${AKMS_MCP_HOME:-$HOME/.akms/mcp}/runtime" "$PWD"` after building (WSL server execution still requires Windows). The package is linked into the prefix without moving the source checkout. Runtime shows **linked development checkout**, hides Update and skips version-update prompts. Rebuild the source to change the running code, then reconnect AI clients. Use Runtime > Use for existing connections to migrate older npm/npx launch paths.

## Session-server compatibility

Setup reads registry versions 1 and 2. New catalogs start at version 2 with `defaultMode: "catalog"`; their first connection of each kind creates its session launch. Existing version 1 catalogs require the confirmed Runtime switch. Existing version 2 catalogs without `defaultMode` retain individual mode for kinds without explicit session state. Per-kind choices override the default, and rollback keeps version 2 so older setup cannot recreate individual entries. Server `--catalog` readers accept both versions without locks or writes. The common `catalog.ts` has no dependency on setup or the optional helper. Include it in the five-copy release comparison. `registration-session.test.ts` covers migration/rollback, backup failure, name budgets, external edits, replacement ordering and bundle startup coverage.

During active MCP development, build a disposable source copy and validate it before replacing live `lib` files. The normal build removes `lib`; running it beneath a connected MCP can break active sessions.

Registry migrations are ordered in `registry.ts`: `v1_to_v2`, then `catalog_default`. `needsMigration`, `planMigration`, and `applyMigration` support scripted review/application; the plan is rechecked under the normal lock. Session planning and state transitions are shared with `planSession`/`applySession`, while one outer mutation preserves the pre-migration backup. `setDefaultMode("individual")` and `setDefaultMode("catalog")` change only the future-kind default after migration. An explicit individual marker remains current format. `registration-migration.test.ts` covers migration, no-op repetition, backup, stale plans, external edits, missing runtimes, rollback preservation and menu approval. Include `migration-menu.ts` in common-file synchronization.
