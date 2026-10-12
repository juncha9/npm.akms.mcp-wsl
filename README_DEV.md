# Development

Sibling of [`@akms/mcp-ssh`](https://github.com/alkemic-studio/npm.akms.mcp-ssh) — same layout, same build, same tool surface with `ssh_` → `wsl_`. The design record with the measurements behind each decision is `akms.docs/mcp-wsl-design.md`.

## 🧑‍💻 Commands

Run from Windows PowerShell at the repository root:

```powershell
npm ci                   # install the locked dependencies
npm run dev -- --check   # tsx, straight from src
npm run dev -- setup     # the distro manager, against this machine's real client configs
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
│   ├── manage/  the `setup` command: prompts, settings form, per-client config writers
│   ├── wsl/     wsl.exe process runner, session manager, file operations, distro status
│   └── tools/   MCP tool registration, output formatting
├── server.ts    createWslMcpServer()
├── cli.ts       bin entry (stdio transport, --check, setup)
└── index.ts     library entry
```

## 🏗️ Design decisions

### What is reused from @akms/mcp-ssh and what is not

Reused as a dependency: `inspectCommand`, `inspectRemotePath`, `inspectLocalPath`, `inspectWorkingDirectory`, `canonicalizeCommand`, the segment analysis helpers, `GuardRejectionError`, and the `SshPolicy` type (as `WslPolicy`, with `connectTimeoutMs` carried as 0). Two servers that refuse different things would need two sets of agent instructions.

Re-implemented: the `cd` wrapper and `$PWD` marker (not exported by mcp-ssh), the logger (its own env var), the text helpers. Written fresh: everything that touched ssh2.

Importing `@akms/mcp-ssh` loads `ssh2` as a side effect of its barrel. It is never used; it is the cost of not extracting a `@akms/mcp-guard` package yet.

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

### `setup` is mcp-ssh's manager with a WSL form

`@akms/mcp-ssh` does not export its `setup` machinery, so the client-agnostic half is copied: `prompter.ts` (arrow-key lists and a raw-mode line editor on a TTY, so Esc is seen everywhere; numbered lists off one), `targets/` (Claude Code through `claude mcp`, Codex by TOML section rewrite, plain `mcpServers` JSON files) and the menu loop. Only the macOS / Linux branches were dropped — the package is win32-only, so every entry launches through `cmd /c npx`. A fix to one of those files almost certainly belongs in both packages.

Written fresh: the settings form (`host-form.ts`) and the entry mapping. There is no connection, so the SSH settings (port, auth, route) and host-key pinning are gone, and so are the rows a choice brings with it — every WSL row is always shown. The distro is picked from `listDistros()` — the `wsl -l -v` rows, matched case-insensitively and written as wsl.exe spells it — and a typed name that is not listed needs an explicit yes. A new entry starts on the default distro, so Save alone writes a complete entry. `WSL_ALLOW_WINDOWS` starts locked, for the reason the server defaults it off.

Esc inside a field returns to the form with the cursor on that row. mcp-ssh's form snapshots and restores its state around every pick, because a route choice opens a jump-host question after the route is already set; no WSL setting does that — every editor assigns only once its prompt is answered — so this form has no snapshot to restore. A setting that ever asks a follow-up after assigning needs one.

The check is the server's own path: the entry about to be written goes through `loadHostProfile(env)` and the same `runDistroCheck` report `--check` prints, so a value the server would reject is caught before it is written. Running `id` starts a stopped distro, which is why the Test row and the Save prompt say so. Full rules and rationale are in [docs/design/setup-command.md](docs/design/setup-command.md).

## 🧪 Testing

| File | Covers |
|---|---|
| `wsl-guard.test.ts` | WSL catastrophe rules, interop, `/mnt` write targets vs reads, operator paths through the mount, path guard |
| `host-profile.test.ts` | `WSL_*` mapping, defaults, malformed values |
| `wsl-command.test.ts` | Argument vector (`--exec`), `cd` wrapper, cwd marker |
| `live-integration.test.ts` | **MCP client ↔ server ↔ real distro** over an in-memory transport: exit codes, argument bytes, UTF-8, closed stdin, bad cwd, session `cd`, timeout, guard rejections proving nothing ran, file round-trips including binary upload/download, unknown distro |
| `manage-entry.test.ts` | `setup` answers ⇄ entry, carried variables, the `loadHostProfile(env)` contract |
| `manage-toml.test.ts` | Codex TOML: append, replace keeping hand-added keys, remove, CRLF |
| `manage-command.test.ts` | **The `setup` UI end to end** — the menu and the settings form over scripted stdin, an injected distro list, a temp JSON config; the failing checks run the real `wsl -l -v` against a name that is not installed |
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

Check that the CLI prints the release version and the package preview contains the built `lib/` files, `README.md` and `LICENSE.md`. After reviewing the changes and package contents, publish with `npm publish`.
