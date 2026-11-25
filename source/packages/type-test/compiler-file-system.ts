/* eslint node/no-sync: "off" -- The native compiler requires synchronous filesystem callbacks. */
import { readFileSync, existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import type { FileSystemStat } from 'typescript-beta/fs';

function missing(error: unknown): boolean {
    const code: unknown = error instanceof Error ? Reflect.get(error, 'code') : null;
    return code === 'ENOENT' || code === 'ENOTDIR';
}
function readFile(path: string): string | undefined {
    try {
        return readFileSync(path, 'utf8');
    } catch (error) {
        if (missing(error)) {
            return undefined;
        }
        throw error;
    }
}
function directoryExists(path: string): boolean {
    try {
        return statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;
    } catch (error) {
        if (missing(error)) {
            return false;
        }
        throw error;
    }
}
function entries(path: string): string[] {
    try {
        return readdirSync(path).toSorted(function byName(left, right) {
            return left.localeCompare(right);
        });
    } catch (error) {
        if (missing(error)) {
            return [];
        }
        throw error;
    }
}
function realpath(path: string): string {
    return existsSync(path) ? realpathSync(path) : path;
}
function stat(path: string): FileSystemStat | undefined {
    try {
        const value = statSync(path, { throwIfNoEntry: false });
        return value === undefined ? undefined : { mode: value.mode, size: value.size, mtime: value.mtime };
    } catch (error) {
        if (missing(error)) {
            return undefined;
        }
        throw error;
    }
}
export const compilerFileSystem = {
    readFile,
    directoryExists,
    entries,
    realpath,
    stat,
    fileExists(path: string): boolean {
        try {
            const value = statSync(path, { throwIfNoEntry: false });
            return value !== undefined && !value.isDirectory();
        } catch {
            return false;
        }
    }
};
