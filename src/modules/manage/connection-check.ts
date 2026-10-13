import type { Writable } from "node:stream";

import type { WslDistroStatus, WslHostProfile } from "@/_types";
import { loadHostProfile } from "@/modules/config";
import { formatDistroStatus } from "@/modules/tools";
import { WslHost, probeDistroFacts, queryDistroListing } from "@/modules/wsl";

/**
 * Builds a profile from an entry's env the way the server will at startup — so a value the
 * server would reject is caught here, not when the agent first calls a tool.
 */
export function profileFromEnv(output: Writable, env: Record<string, string>): WslHostProfile | null {
    try {
        const profile = loadHostProfile(env);
        if (profile == null) {
            output.write("  The entry has no distro.\n");
        }
        return profile;
    }
    catch (ex) {
        let detail = String(ex);
        if (ex instanceof Error) {
            detail = ex.message;
        }
        output.write(`  The server would refuse to start with this entry: ${detail}\n`);
        return null;
    }
}

/**
 * Looks the distro up, runs `id` in it, and reports what happened — the body of `--check`,
 * shared with the `config` command so a distro that passes the configuration check passes `--check`.
 *
 * Without this the only way to find out whether the setup works is to ask an agent to try
 * something, which mixes a setup mistake up with a policy rejection.
 *
 * @returns True when the distro answered as the configured user.
 */
export async function runDistroCheck(profile: WslHostProfile, output: Writable): Promise<boolean> {
    const endpoint = `${profile.username ?? "(distro default)"}@${profile.distro}`;
    output.write(`Checking ${profile.name}  →  ${endpoint}\n\n`);

    let listing: WslDistroStatus;
    try {
        listing = await queryDistroListing(profile.distro);
    }
    catch (ex) {
        let detail = String(ex);
        if (ex instanceof Error) {
            detail = ex.message;
        }
        output.write(`  FAILED  wsl.exe could not be started: ${detail}\n`);
        return false;
    }

    if (listing.installed == false) {
        output.write(`  FAILED  ${formatDistroStatus(listing)}\n`);
        return false;
    }

    const host = new WslHost(profile);
    const startedAt = Date.now();

    try {
        const probe = await host.exec({
            command: "id",
            timeoutMs: profile.policy.execTimeoutMs,
            maxOutputCharacters: profile.policy.maxOutputCharacters,
            trackCwd: false,
        });
        const durationMs = Date.now() - startedAt;

        if (probe.exitCode !== 0) {
            output.write(`  FAILED  ${endpoint}  exit code ${probe.exitCode}\n          ${probe.stderr.trim()}\n`);
            return false;
        }

        const facts = await probeDistroFacts(host);
        output.write(`  OK      ${probe.stdout.trim()}  (${durationMs}ms)\n`);
        output.write(`          ${formatDistroStatus({ ...listing, ...facts })}\n`);
        return true;
    }
    catch (ex) {
        let detail = String(ex);
        if (ex instanceof Error) {
            detail = ex.message;
        }
        output.write(`  FAILED  ${endpoint}\n          ${detail}\n`);
        return false;
    }
}
