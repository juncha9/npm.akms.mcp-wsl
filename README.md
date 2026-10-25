# @akms/mcp-wsl

> 🔒 Internal use only — built for our organization's services.

MCP server that lets an AI agent run shell commands and transfer files in a WSL distro **on this machine**, through `wsl.exe`.

No sshd in the distro, no key, no port, no networking mode to keep alive: the first call starts the distro if it is stopped, and the Linux user is one variable. The distro is **pre-registered** in the server's own environment; the agent never names a distro or a user, and no tool takes one. Every command and path is screened by the [`@akms/mcp-ssh`](https://www.npmjs.com/package/@akms/mcp-ssh) guard policy plus the rules that only a WSL host needs.

Windows only — the transport is `wsl.exe`. For reaching a WSL distro from *another* machine, keep using `@akms/mcp-ssh` against its sshd.

Use **session server mode** to share one process among this kind's connections in each client session. Each connection keeps its own target, credentials and policy; its tool names carry the connection prefix. The environment-based examples below describe individual mode. See [Session server mode](#session-server-mode).

## 📦 Installation

Run these commands from Windows PowerShell with Node.js and npm installed. The target distro must already be registered with WSL and have `bash` available; `config` registers MCP entries, not new WSL installations.

```powershell
npm install -g @akms/mcp-wsl@latest   # installs the `akms-mcp-wsl` command
akms-mcp-wsl --help
wsl -l -v                    # list the installed distros
```

## Upgrading from 0.2.x

Open the current setup with `npx -y --prefer-online @akms/mcp@latest`, install this runtime from **Runtime**, then use **Register > Apply registration** to import existing entries. Compare differing descriptions when prompted, or use **Import existing connections** later.

If you register before installing the runtime, existing entries are kept in a normal pending state. Install the runtime, run **Sync**, then restart or reconnect your client and check `wsl_catalog_status`.

See the launcher's [full upgrade guide](https://github.com/juncha9/npm.akms.mcp/blob/main/README.md#upgrading-from-02x) for the comparison steps, Codex thread cleanup, rollback and **Migrate registry** for older development catalogs.

## Minimum working configuration

Install the server from **Runtime** before using these manual examples. On Windows its script is `<AKMS_MCP_HOME or ~/.akms/mcp>/runtime/node_modules/@akms/mcp-wsl/lib/cli.js`; on macOS/Linux insert `lib/` before `node_modules`. Replace the placeholder below with that absolute path. Use the Node executable from `node -p "process.execPath"` as `command`. The `config` command writes both paths for you.

Run the MCP client on Windows with Node.js 18+ and npm available. Install the target WSL distro first; it must have `bash`. Use the exact distro name from `wsl -l -q` in this entry, replacing `Ubuntu` if necessary:

```json
{
    "mcpServers": {
        "wsl_ubuntu": {
            "command": "node",
            "args": ["C:/absolute/akms/mcp/runtime/node_modules/@akms/mcp-wsl/lib/cli.js"],
            "env": {
                "WSL_DISTRO": "Ubuntu"
            }
        }
    }
}
```

`WSL_DISTRO` is the only required variable. Commands use that distro's default Linux user; add `WSL_USER` only to select another existing user. No SSH credentials are needed. The first tool call starts a stopped distro. Writes inside Linux are allowed by default; add `"WSL_READONLY": "true"` for a read-only entry. Windows interop and writes under `/mnt/<drive>/` remain disabled unless explicitly allowed.

The JSON example fits an MCP client's `mcpServers` configuration, such as a project `.mcp.json` or Cursor's `mcp.json`. For Codex TOML, open Register from `akms-mcp-wsl config --target codex` from Windows (or choose another client below).

## ⚙️ MCP client setup

Register the AI services you use once, then manage connections in one shared list. **This package works independently; installing or running `@akms/mcp` is optional.**

```sh
akms-mcp-wsl register   # toggle services, then Apply registration
akms-mcp-wsl config     # add, edit, check, print or remove connections
akms-mcp-wsl sync       # review differences and retry pending changes
```

### AKMS runtime and existing connections

Managed connections start Node directly using a dedicated installation at `<AKMS_MCP_HOME or ~/.akms/mcp>/runtime`. This directory is independent of Node version managers. The setup CLI may be installed globally as above or opened once with `npx -y @akms/mcp-wsl@latest config`; it is separate from the server runtime saved in client settings.

Before Add or a standard-launch Edit, setup installs a missing runtime with `npm install --global --prefix "<AKMS runtime directory>" --prefer-online --no-fund --no-audit @akms/mcp-wsl@latest`. If the installed version is older than this setup package, it offers an update (default Yes); declining continues with the installed version. Linked development packages skip this prompt. Host-key saves for standard launches also check the runtime before writing. Custom launch commands keep their existing command and require no managed-runtime installation. If an update fails but an installed runtime is still usable, setup reports the error and continues with that version. Servers do not invoke npm or query updates when AI clients connect.

For an existing catalog that still uses individual entries, open `akms-mcp-wsl config`, choose **Runtime**, install the runtime if needed, then choose **Use for existing connections**. Both legacy npx entries and direct paths in ordinary global installations can be converted. Review and apply the list, then **restart or reconnect the AI clients** to replace running processes. Connection values and credentials stay intact; custom commands and external client edits are preserved for individual review. Register/import legacy entries first if they are missing from the shared list. Version-pinned npx entries switch to the installed version shown in the preview.

**Runtime > Update runtime installation** explicitly installs the latest release into this same directory. The Node executable keeps its existing alias path, allowing nvm-windows to switch Node versions while the package path stays fixed. If the Node command path or `AKMS_MCP_HOME` moves, reapply current paths from Runtime. Removing the runtime directory breaks entries that use it.

For development, build the checkout and link it with `npm install -g --prefix "<AKMS runtime directory>" "<checkout path>"`. Linked packages retain the runtime alias path; automatic updates do not overwrite the checkout link. See [README_DEV.md](README_DEV.md). `@akms/mcp` remains optional.

`config` always shows the connection menu, including Add, Register, Sync, Import and Runtime. With no registered services, Add displays a message asking you to open Register and returns to the menu without opening a form or changing settings. Claude Code, Codex, Claude Desktop and Cursor are supported; Enter toggles each service and Apply saves the selection. `--target codex` preselects Codex in Register; it does not restrict subsequent saves to Codex.

On an interactive terminal, connection menus, registration and comparisons use separate screens. Results and errors stay visible until Enter or Esc; returning to the menu shows current services and any connections needing attention. Piped commands keep plain output and need no extra answers. Sync labels the saved AKMS version and the current service version separately. Numbered choices show which service receives a value or whether it becomes the AKMS value for all registered services. Long values wrap, changed text is highlighted, and confirmation names the destinations.

Service selection is shared across the AKMS packages. Every saved connection is applied to all registered services, and a newly registered service receives existing shared connections. Unregistering removes only entries managed by AKMS from that service and retains the shared catalog. Restart or reconnect the MCP client to load changed settings.

### Startup checks and updates

After saving a changed connection, applying Runtime launch commands, or updating from **Updates**, setup starts each distinct saved command once without shell interpolation. It sends MCP `initialize` and `tools/list`, then closes stdin; it does not invoke database, SSH, WSL or S3 tools. The check takes at most about 10 seconds per entry, plus bounded process cleanup. Results show the server version and tool count, or the exit code and masked stderr tail. Standard runtime script paths and spawn command paths stay visible for diagnosis. Session checks also verify a tool-name prefix for every saved connection. A failed check keeps the saved settings: fix it before restarting or reconnecting AI clients. Identical command/arguments/environment values share one check.

Open **Updates** in the launcher or any package config menu to see installed and latest published runtime versions. Version lookup runs only when this screen opens or **Refresh versions** is chosen, with a short timeout; offline results show **Unavailable**. Update one runtime or all installed runtimes with newer releases; missing runtimes can be installed individually. Development links are displayed but never updated, and WSL is listed only on Windows. Updates use the same dedicated AKMS runtime directory and check that kind's saved connections afterward. Reconnect your AI clients to use the new runtime. The helper itself is not updated here.

Register confirmation defaults to **No** when deselecting a previously registered service; otherwise it defaults to **Yes**.

### Session server mode

New catalogs start in version 2 with session mode enabled. Register your AI services, then add connections; setup creates each kind's session entry automatically. Existing version 1 catalogs keep individual mode until you approve **Migrate registry** or a per-kind **Runtime > Switch to session server** conversion (default No). Register/import their existing connections first. Each registered AI service gets one `akms_db`, `akms_ssh`, `akms_wsl` or `akms_s3` entry for that kind, running Node directly with `--catalog`. The helper package is optional. A client session still owns its own stdio process; connections of the same kind share that process.

The server reads its connections from the shared catalog at startup. Tools include the connection name, for example `production__db_query`; their arguments stay unchanged. Add/Edit/Remove updates the catalog; reconnect your clients to load changes. Removing the last connection removes the session entry. An invalid connection is excluded while valid ones remain available; `<kind>_catalog_status` reports the loaded/excluded names without credentials. No database, SSH, WSL or S3 connection opens just to list tools.

Converting an existing version 1 catalog upgrades it to version 2 and keeps the previous revision. Older setup packages stop without modifying version 2. New kinds in a new catalog also default to sessions; each kind's explicit rollback choice is retained. AKMS removes managed individual entries only after verifying the session entry; external edits stay for **Sync** review. Custom launch commands are retained in the catalog for rollback but are not executed in session mode.

**Runtime > Switch back to per-connection entries** previews and restores the saved individual entries, including their credentials and launch commands. It removes the session entry after the replacements are verified. The registry stays version 2. **Reapply session launch command** updates paths after moving Node or the runtime. Restart/reconnect clients after either change.

Connection names use ASCII letters, digits, underscores or hyphens: DB up to 35 characters, SSH/WSL 30, S3 37. The four `akms_<kind>` names are reserved. These limits keep client-prefixed tool names within 64 characters; rename longer legacy entries before conversion.

### Migrate an older registry

When a version 1 registry or a version 2 registry without a default-mode marker is opened, the helper and each config menu show **Registry update available** and **Migrate registry**. Select it to review the ordered format steps, every kind's current layout, per-service additions/removals, and settings kept for Sync. Approval defaults to **No**.

Migration upgrades v1 to v2, records `defaultMode: "catalog"`, and converts individual kinds through the existing session conversion rules. Kinds explicitly switched back to individual entries keep that choice. Already bundled kinds keep their launch commands; an unmarked v2 containing only bundles receives the marker without client-file changes. Missing runtimes leave existing entries in place for **Runtime** installation and **Sync**. Startup checks verify the affected session tools after approval.

One `registry.previous.json` revision covers the whole migration. Repeating migration on a current registry does nothing. Runtime still offers per-kind conversion and rollback. **Runtime > Use individual entries for new kinds** turns the future-kind default off, and **Start new kinds as session servers** turns it back on; existing kinds retain their modes. The explicit `individual` default is also current format, so turning it off does not trigger another migration notice.

### Catalog security

The shared catalog is `~/.akms/mcp/registry.json`, or `$AKMS_MCP_HOME/registry.json`. It contains complete connection settings, including passwords and secret values **in plaintext**. In individual mode these values also appear in AI client entries. After successful session-mode conversion and resolution of any retained legacy entries, the catalog is the only active location for that kind's connection credentials; one previous-revision copy also contains them. WSL settings normally need no password, but this shared catalog can also contain DB, SSH and S3 credentials. SSH private-key settings store file paths, not the key files themselves.

On POSIX, new catalog files request mode `0600` and new catalog directories `0700`; existing permissions are not tightened. Windows uses inherited parent-directory ACLs (normally the user profile), not POSIX owner/group modes. Check access permissions when choosing a custom location.

Keep both catalog files private: do not commit it, share it, copy it to another person or PC, paste its contents into chats/issues/AI conversations, or ask an AI agent to print it. Exclude it from cloud sync and shared backups, or protect those copies. Prefer SSH key authentication over passwords where possible. If exposed, change the affected passwords or rotate the affected keys/tokens, then update the connections through `config`.

SSH blocks local uploads from and downloads into `.akms/mcp`. A custom `AKMS_MCP_HOME` outside that path is not protected as a whole: its `registry.json` and `registry.previous.json` are additionally blocked when the SSH process has that environment variable. Remote SSH paths have no catalog-specific block. WSL protects these paths through `/mnt/<drive>/`; native Linux paths have no catalog-specific block. WSL's local Windows uploads and downloads use the guard from its `@akms/mcp-ssh` ^0.3.1 dependency and block the same local catalog paths. Do not rely on these guards to keep the file private.

Each successful catalog-changing operation atomically keeps one previous revision as **`registry.previous.json`** in the same directory. Internal application bookkeeping does not replace that pre-operation revision, and a no-op Sync leaves it unchanged. The copy requests the catalog's existing file permissions; Windows uses inherited ACLs. This is one revision, not a history.

To recover, close configuration commands, preserve the current file if needed, and copy `registry.previous.json` over `registry.json` in that directory. Then reopen setup, review **Sync**, and reconnect clients. Recovery does not automatically revert client files.

A running session keeps its startup snapshot. If `registry.json` is missing or invalid, a newly started session exposes only its status tool; its empty client entry cannot reconstruct credentials through Import. Restore the previous revision or enter the connections again. Individual mode still uses each entry's environment, so its existing client entries keep working and can be imported after registering services again.

Each standalone package manages this versioned file directly and does not call the optional helper.

Register shows existing AKMS entry counts even before registration. Applying registration automatically imports existing connections whose versions match, merging identical copies into one shared item. In session mode, it replaces owned individual entries after verifying the session launch. If a runtime is missing, the existing entries stay in place: install it from Runtime, then run Sync. Differing versions remain intact for review. Results summarize completed connections and list only items needing attention. The comparison shows changed fields, labels description-only differences, and keeps secrets hidden. Use **Import existing connections** to review differences later or import all remaining matching entries together. When versions differ, review the masked settings and choose which version to apply, or give the imported connection another name to keep both. The menu shows per-connection application counts. Failed writes keep the saved values and successful service updates; **Sync** retries pending changes and offers explicit choices for external edits. Unrelated or conflicting unmanaged entries are preserved.

Codex configs are validated before and after editing. Inline/dotted server definitions
are recognized, but automatic edits require the `[mcp_servers.<name>]` table layout;
unsupported edits are rejected without changing the file. JSON and TOML saves use a
temporary file so a failed write or commit preserves the previous config.

On a terminal, checks in `config` and `--check` show animated progress, elapsed time and
completed phases. After a check in `config`, **press Enter to continue**; Esc goes back and
Ctrl+C exits. Redirected output stays plain and scripted input needs no extra answer.
Release notes are in [CHANGELOG.md](CHANGELOG.md).

| Client | Config file | How it is written |
|---|---|---|
| Claude Code | `~/.claude.json` (user scope) | through `claude mcp add-json … -s user`, never by editing the file |
| Codex | `$CODEX_HOME/config.toml` (defaults to `~/.codex/config.toml`) | only the `[mcp_servers.<name>]` tables are rewritten; keys you added to them stay |
| Claude Desktop | `%APPDATA%\Claude\claude_desktop_config.json` | `mcpServers.<name>` is set, every other key kept |
| Cursor | `~/.cursor/mcp.json` | same |

Only entries that launch this package are listed for management. An edit keeps every `WSL_*` variable the form does not show (`WSL_CWD`, `WSL_ALLOW_SUDO`, allow-lists, timeouts, …). **Print** shows an entry as JSON, as a Codex TOML table and as a `claude mcp add-json` line, for when pasting is easier. Entries use the absolute Node executable and the script in the AKMS runtime directory.

**Or by hand — one server entry per distro and user** — plain `WSL_*` variables in the MCP client's config, with no separate server config file. Claude Code reads `.mcp.json` in the project or `~/.claude.json` globally; Claude Desktop takes the same block inside `claude_desktop_config.json`. Use the direct Node command generated by `config`:

```json
{
    "mcpServers": {
        "wsl_ubuntu_root": {
            "command": "node",
            "args": ["C:/absolute/akms/mcp/runtime/node_modules/@akms/mcp-wsl/lib/cli.js"],
            "env": { "WSL_DISTRO": "Ubuntu", "WSL_USER": "root", "WSL_DESCRIPTION": "nginx, cloudflared and the test stack" }
        },
        "wsl_ubuntu_deploy": {
            "command": "node",
            "args": ["C:/absolute/akms/mcp/runtime/node_modules/@akms/mcp-wsl/lib/cli.js"],
            "env": { "WSL_DISTRO": "Ubuntu", "WSL_USER": "deploy", "WSL_READONLY": "true", "WSL_ALLOWED_PATHS": "/var/log,/opt/app" }
        }
    }
}
```

`WSL_DISTRO` is the whole minimum (the name as `wsl -l -q` prints it). Because each server fronts one distro *as one user*, the agent never picks either: `wsl_exec({ command: "df -h" })` is a complete call, and root access is a matter of which entry exists — not of an argument. The server name is what the agent sees in its tool list, so put the user in it.

The server speaks MCP over **stdio**: stdout carries the JSON-RPC stream and all logging goes to stderr. When the client goes away — stdin ends, or the process is simply gone — the server exits within a few seconds on its own; a stderr nobody reads is never a reason to stay. Its log says `mcp server ready on stdio` with its `pid`, for when one has to be found among a client's processes.

## 🗂️ Distro configuration

| `WSL_*` variable | Description |
|---|---|
| `WSL_DISTRO` ✅ | Distro name as `wsl -l -q` prints it. Required by name — following `wsl --set-default` would let a machine-wide setting silently redirect every command |
| `WSL_USER` | Linux user (`wsl -u`). The distro's default user when unset |
| `WSL_NAME` | Alias shown to the agent; defaults to the distro name |
| `WSL_DESCRIPTION` | Shown to the agent — say what the distro is for |
| `WSL_CWD` | Directory new sessions start in |

### Policy

| `WSL_*` variable | Default | Effect |
|---|---|---|
| `WSL_READONLY` | `false` | Rejects write commands, output redirection, package installs, uploads and writes |
| `WSL_ALLOW_SUDO` | `true` | When false, rejects `sudo` / `su` / `doas` / `pkexec` / `runuser` / `chroot` |
| `WSL_ALLOW_WINDOWS` | **`false`** | When false, rejects Windows interop executables (`powershell.exe`, `cmd.exe`, any `.exe`) and **writes** whose target is under `/mnt/<drive>/`. Reads and copies *out of* `/mnt` are always allowed |
| `WSL_ALLOW_COMMANDS` | *(none)* | When set, only these binaries may run (`pwd` is added automatically so sessions can open) |
| `WSL_DENY_PATTERNS` | *(none)* | Extra regex sources, compiled at startup and tested per command segment |
| `WSL_ALLOWED_PATHS` | *(none)* | When set, the file tools accept only absolute paths inside these prefixes |
| `WSL_EXEC_TIMEOUT_MS` | `60000` | Per-command wall clock; `wsl.exe` is killed when it elapses |
| `WSL_MAX_OUTPUT` | `100000` | stdout and stderr are each truncated past this |
| `WSL_MAX_READ_BYTES` | `200000` | `wsl_read_file` ceiling |

The stance is `@akms/mcp-ssh`'s: **permissive by default**, restriction opt-in, and a malformed value fails startup (`WSL_READONLY=ture` is an error, not "not read-only"). The one default that differs is `WSL_ALLOW_WINDOWS`, and the reason is in the security notes below.

### Check it before wiring it up

`--check` reads the current process's `WSL_*` environment, not the MCP client's saved entries. Set the variables in the same PowerShell session, using an installed distro and Linux user:

```powershell
$env:WSL_DISTRO = "Ubuntu"
$env:WSL_USER = "root"        # optional; omit to use the distro's default user
akms-mcp-wsl --check
```

```
Checking Ubuntu  →  root@Ubuntu

  OK      uid=0(root) gid=0(root) groups=0(root)  (115ms)
          distro: Running  ·  WSL 2  ·  networking mirrored  ·  systemd  ·  kernel 5.15.146.1-microsoft-standard-WSL2
```

To check a saved entry, open `config`, select the entry, then **Check the distro**. Both checks run `id` as the configured user and can start a stopped distro. If `WSL_ALLOW_COMMANDS` is set, include `id` for the check to pass. `--check` exits with code `0` on success and `1` on failure.

## 🧰 Tools

| Tool | Purpose |
|---|---|
| `wsl_list_hosts` | The configured distro and user, the guard policy, and the distro's state: running/stopped, WSL version, networking mode, whether systemd is PID 1 |
| `wsl_connect` | Open a session (a remembered working directory), returns a session id |
| `wsl_disconnect` | Forget a session |
| `wsl_list_sessions` | Open sessions with cwd, command count and idle time |
| `wsl_exec` | Run a command in a login bash; returns stdout, stderr, exit code, duration |
| `wsl_list_dir` | Directory listing (type, mode, size, mtime) |
| `wsl_read_file` | Read a text file, truncated to the byte ceiling |
| `wsl_write_file` | Write or append UTF-8 text |
| `wsl_upload` | Local → distro file transfer |
| `wsl_download` | Distro → local file transfer |

### Every call is its own process

There is no connection to keep. Each tool call spawns `wsl.exe -d <distro> -u <user> --exec bash -lc <script>` and waits for it — about 100 ms of overhead, no handshake. A **session** therefore carries exactly one thing between calls: the working directory, so `cd /opt/app` in one `wsl_exec` still applies to the next. Environment variables, background jobs and `sudo` timestamps do not carry over, because the process that held them has exited.

`--exec`, never `--`: with `--`, `wsl.exe` hands the command to the distro's default shell for a *second* parse, which strips backslashes and expands `$HOME` before bash ever sees the script — the text the guard screened would not be the text that runs.

### Commands run without a terminal

stdin is closed, so anything that waits for input fails fast instead of hanging until the timeout: `sudo` without `NOPASSWD` fails with `a password is required`, prompts need their non-interactive flag (`apt-get -y`), full-screen tools have no TTY (`top -bn1`, `wsl_write_file` instead of an editor).

**A background job must detach all three descriptors**, or `wsl.exe` waits on the open pipe until the timeout kills it:

```bash
nohup ./build.sh > /tmp/build.log 2>&1 < /dev/null &
```

When the timeout fires, `wsl.exe` is killed; the process inside the distro may survive. The reply says so.

### File tools go through the distro process

`wsl_read_file` is `head -c`, `wsl_write_file` is `cat >`, transfers are `cat` over stdin/stdout — byte-clean pipes, so binaries round-trip intact. This is deliberate: the `\\wsl$\` share opens every file as the distro's *default* user, so a `root` entry could not have written `/etc/nginx/…` through it. Through the process, the registered user's permissions are the permissions.

These scripts have no variable part but the quoted path, so they bypass the command guard the way SFTP does in `@akms/mcp-ssh`; the **path** guard (`WSL_ALLOWED_PATHS`, read-only, the `/mnt` rules) governs them instead. `WSL_ALLOW_COMMANDS` need not list `cat` or `find`.

## 🛡️ Guard policy

The command guard is `@akms/mcp-ssh`'s, unchanged — catastrophe rules always on (`rm -rf /`, `mkfs`, `dd of=/dev/sda`, `shutdown`, fork bombs…), the rest opt-in. Its threat model is a **mistaken agent, not an adversary**, and so is this server's. On top:

| Layer | Scope | Examples |
|---|---|---|
| **WSL catastrophe** | Always | `wsl --shutdown` / `--terminate` / `--unregister`, `wslconfig /t`, `poweroff`, `systemctl poweroff`, `init 0` |
| `WSL_ALLOW_WINDOWS=false` | Default | any segment whose binary is a Windows executable (`powershell.exe`, `cmd.exe`, `explorer.exe`, `*.exe`); any write-shaped segment whose **target** is under `/mnt/<drive>/` — a redirection, `cp`'s last operand, `tar -c`'s archive, `rm`/`sed -i`/`mv` operands |
| **Operator paths** | Always, even when Windows is open | `/mnt/c/Users/<you>/.ssh`, `.aws`, `.gnupg`, `*.pem`, `.claude.json`, `.mcp.json`, `claude_desktop_config.json` — the same list `@akms/mcp-ssh` protects on the local side, reached through the mount |

Both `wsl_exec` and the file tools enforce these; the rules live in the layer every command and path passes through, so a new tool cannot forget them. A rejection returns the rule that fired, the offending segment, and the note that nothing was run.

## ⚠️ Security notes

**In WSL, the "remote" is your own machine.** `@akms/mcp-ssh` can say "the remote account is the real boundary" because a compromised remote account stays remote. Here the distro shares the Windows filesystem under `/mnt` and can launch Windows programs through interop — and among the files it can reach that way is the MCP client configuration that defines this server's own `WSL_*` policy. An agent that writes `~/.claude.json` rewrites its guards for the next run. That is why `WSL_ALLOW_WINDOWS` is the one restriction on by default, and why the operator's credential and configuration paths stay refused even when it is turned on.

- Prefer a dedicated Linux user per entry over `root`, with `sudoers` scoped to what it needs — the guard is a seatbelt, the account is the containment.
- The catastrophe rules read the command as text. A shell can express the same operation in unlimited ways; the guard stops mistakes, not intent.
- Output from the distro is untrusted input: a file the agent reads can contain instructions.
- Local paths in `wsl_upload` / `wsl_download` are resolved on Windows, so a POSIX-looking `/tmp/x` becomes `<current drive>\tmp\x`. Every transfer reply prints the resolved path — check it.

## Memory and process lifetime

The server reuses command and path guards from `@akms/mcp-ssh` ^0.3.1 without loading its SSH/crypto runtime. A WSL command still runs through `wsl.exe`; no SSH connection or parser worker is involved.

Command output is bounded, and upload/download bodies stream through pipes. Sessions retain working-directory state, not a persistent shell or command history; unused sessions expire after 15 minutes, with active operations skipped by the sweeper. These limits do not force Node's RSS back to its startup value after use.

The Node MCP process, an optional npm/npx wrapper, and the WSL virtual machine have separate memory costs. Session expiry only removes MCP state: this server does not shut down a distro, stop its background jobs, or force Linux cache reclamation to recover memory. Updating this package takes effect when the MCP process is restarted.

## 📄 Logging

Everything goes to **stderr**. `WSL_MCP_LOG_LEVEL` picks the level — `silent` / `debug` / `info` / `warn` / `error`, default `info`. Guard rejections are logged at `warn` with the full command; full command text is otherwise only logged at `debug`.

## 🧑‍💻 Development

Building on this server, embedding it as a library, or changing the guards — see [README_DEV.md](README_DEV.md).

## 📜 License

MIT — see [LICENSE.md](LICENSE.md).
