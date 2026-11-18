import { createHash } from 'node:crypto';
import { mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import lockfile from 'proper-lockfile';
import type { PropertyCorpusSnapshot } from '../engine/property-corpus.ts';
import { createNodeFileStore, type FileStore } from '../file-store.ts';
import {
    propertyWitnessSchema,
    type PropertyWitnessFile
} from '../engine/witness-file.ts';
import type { PropertyCorpusPolicy } from '../config/types.ts';
import {
    parseCorpusCache,
    boundedCorpusCache,
    type CorpusCache,
    type CorpusDiagnostic
} from './property-corpus-cache.ts';

export type CorpusDirectoryEntry = { readonly name: string; readonly kind: 'directory' | 'file' | 'other'; };
export type PropertyCorpusAccess = {
    readonly files: Pick<FileStore, 'read' | 'write'>;
    readonly directory: (target: string) => Promise<boolean>;
    readonly children: (target: string) => Promise<readonly CorpusDirectoryEntry[]>;
    readonly prepare: (target: string) => Promise<void>;
    readonly lock: (target: string) => Promise<() => Promise<void>>;
    readonly now: () => string;
};
export type PropertyCorpusRead = {
    readonly projectRoot: string;
    readonly directory: string;
    readonly profile: string;
    readonly policy: PropertyCorpusPolicy;
};
export type PropertyCorpusWrite = {
    readonly directory: string;
    readonly profile: string;
    readonly policy: PropertyCorpusPolicy;
    readonly entries: readonly PropertyWitnessFile[];
};
function cachePath(directory: string, profile: string): string {
    const identity = createHash('sha256').update(profile).digest('hex');
    return path.join(directory, 'corpus', identity, 'index.json');
}

async function entryPaths(target: string, access: PropertyCorpusAccess): Promise<readonly string[]> {
    if (!await access.directory(target)) {
        return [ target ];
    }
    const entries = await access.children(target);
    const paths = await Promise.all(entries.map(async function discover(entry) {
        const child = path.join(target, entry.name);
        if (entry.kind === 'directory') {
            return await entryPaths(child, access);
        }
        return entry.kind === 'file' && entry.name.endsWith('.json') ? [ child ] : [];
    }));
    return paths.flat();
}

function parsedWitness(content: string | null): PropertyWitnessFile {
    return propertyWitnessSchema.parse(JSON.parse(content ?? 'null'));
}

async function readCheckedInEntry(file: string, access: PropertyCorpusAccess): Promise<PropertyWitnessFile> {
    try {
        return parsedWitness(await access.files.read(file));
    } catch (error: unknown) {
        throw new Error(`Cannot read checked-in corpus entry ${file}.`, { cause: error });
    }
}

async function readCache(file: string, access: PropertyCorpusAccess): Promise<CorpusCache> {
    try {
        return parseCorpusCache(await access.files.read(file), file);
    } catch (error: unknown) {
        return { entries: [], diagnostics: [ { path: file, reason: String(error) } ] };
    }
}

export async function loadPropertyCorpus(
    input: PropertyCorpusRead,
    access: PropertyCorpusAccess
): Promise<PropertyCorpusSnapshot> {
    const { projectRoot, directory, profile, policy } = input;
    const files = await Promise.all(policy.checkedIn.map(async function discover(target) {
        return await entryPaths(path.resolve(projectRoot, target), access);
    }));
    const paths = Array.from(new Set(files.flat())).toSorted(function alphabetic(left, right) {
        return left.localeCompare(right);
    });
    const checkedIn = await Promise.all(paths.map(async function loadCheckedIn(file) {
        return await readCheckedInEntry(file, access);
    }));
    const cache = await readCache(cachePath(directory, profile), access);
    return {
        checkedIn,
        localCache: cache.entries.map(function cachedInput(entry) {
            return entry.entry;
        }),
        diagnostics: cache.diagnostics
    };
}

async function commitCache(
    file: string,
    policy: PropertyCorpusPolicy,
    entries: readonly PropertyWitnessFile[],
    access: PropertyCorpusAccess
): Promise<readonly CorpusDiagnostic[]> {
    const next = boundedCorpusCache(await readCache(file, access), entries, { file, policy, now: access.now() });
    if (next.content !== null) {
        await access.files.write(file, next.content);
    }
    return next.diagnostics;
}

export async function persistPropertyCorpus(
    input: PropertyCorpusWrite,
    access: PropertyCorpusAccess
): Promise<readonly CorpusDiagnostic[]> {
    const { directory, profile, policy, entries } = input;
    if (entries.length === 0) {
        return [];
    }
    const file = cachePath(directory, profile);
    const parent = path.dirname(file);
    await access.prepare(parent);
    const release = await access.lock(parent);
    try {
        return await commitCache(file, policy, entries, access);
    } finally {
        await release();
    }
}

function nativeCorpusAccess(): PropertyCorpusAccess {
    return {
        files: createNodeFileStore(),
        async directory(target) {
            const metadata = await stat(target);
            return metadata.isDirectory();
        },
        async children(target) {
            const entries = await readdir(target, { withFileTypes: true });
            return entries.map(function child(entry): CorpusDirectoryEntry {
                if (entry.isFile()) {
                    return { name: entry.name, kind: 'file' };
                }
                return {
                    name: entry.name,
                    kind: entry.isDirectory() ? 'directory' : 'other'
                };
            });
        },
        async prepare(target) {
            await mkdir(target, { recursive: true });
        },
        async lock(target) {
            return await lockfile.lock(target, { retries: { retries: 50, minTimeout: 25, maxTimeout: 100 } });
        },
        now() {
            const now = new Date();
            return now.toISOString();
        }
    };
}
export async function readPropertyCorpus(
    projectRoot: string,
    directory: string,
    profile: string,
    policy: PropertyCorpusPolicy
): Promise<PropertyCorpusSnapshot> {
    return await loadPropertyCorpus({ projectRoot, directory, profile, policy }, nativeCorpusAccess());
}
export async function savePropertyCorpus(
    directory: string,
    profile: string,
    policy: PropertyCorpusPolicy,
    entries: readonly PropertyWitnessFile[]
): Promise<readonly CorpusDiagnostic[]> {
    return await persistPropertyCorpus({ directory, profile, policy, entries }, nativeCorpusAccess());
}
