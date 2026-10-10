import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Absolute path of an executable on `PATH`, or null. Only `PATHEXT` suffixes are tried —
 * npm drops an extensionless POSIX shell script next to every `.cmd` shim, and that file
 * exists but cannot be launched.
 */
export function findExecutable(name: string): string | null {
    const searchPath = process.env.PATH ?? "";
    const directories = searchPath.split(path.delimiter).filter((directory) => directory !== "");

    const pathExt = process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD";
    const suffixes = pathExt.split(";").filter((suffix) => suffix !== "");

    for (const directory of directories) {
        for (const suffix of suffixes) {
            const candidate = path.join(directory, `${name}${suffix}`);
            if (fs.existsSync(candidate) == true && fs.statSync(candidate).isFile() == true) {
                return candidate;
            }
        }
    }

    return null;
}

/** Expands a leading `~` to the local home directory and returns an absolute path. */
export function expandHomePath(inputPath: string): string {
    let expanded = inputPath;
    if (inputPath === "~") {
        expanded = os.homedir();
    }
    else if (inputPath.startsWith("~/") == true || inputPath.startsWith("~\\") == true) {
        expanded = path.join(os.homedir(), inputPath.slice(2));
    }

    return path.resolve(expanded);
}

/** True for POSIX absolute paths — the only form the path guard can reason about. */
export function isAbsoluteDistroPath(distroPath: string): boolean {
    return distroPath.startsWith("/");
}

/**
 * `/mnt/c/Users/x` → `C:/Users/x`, or null when the path is not under a drive mount.
 *
 * Lexical, like the default `automount` layout — a custom `/etc/wsl.conf` mount root is
 * not read. That is fine for a guard whose job is to recognise the operator's own
 * credential and configuration paths, which live under the default mount.
 */
export function mountPathToWindows(distroPath: string): string | null {
    const match = /^\/mnt\/([a-z])(?:\/(.*))?$/i.exec(distroPath.trim());
    if (match == null) {
        return null;
    }

    const drive = match[1].toUpperCase();
    const rest = match[2] ?? "";
    return `${drive}:/${rest}`;
}
