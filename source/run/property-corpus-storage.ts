import { createHash } from 'node:crypto';
import { mkdir, readdir, stat, rm } from 'node:fs/promises';
import path from 'node:path';
import lockfile from 'proper-lockfile';
import { z } from 'zod/v4';
import type { PropertyCorpusSnapshot } from '../engine/property-corpus.ts';
import { createNodeFileStore, type FileStore } from '../file-store.ts';
import {
    propertyWitnessSchema,
    type PropertyWitnessFile
} from '../engine/witness-file.ts';
import type { PropertyCorpusPolicy } from '../config/types.ts';
import {
    corpusEntryIdentity,
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
    readonly savedAt: (target: string) => Promise<string>;
    readonly remove: (target: string) => Promise<void>;
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

export const corpusIndexSchema = z.strictObject({
    version: z.literal(1),
    entries: z.array(z.strictObject({
        id: z.string().regex(/^[a-f0-9]{64}$/u),
        savedAt: z.iso.datetime()
    }))
});
function inputPath(file: string, id: string): string {
    return path.join(path.dirname(file), 'inputs', `${id}.json`);
}
type InputReference = { readonly id: string; readonly savedAt: string | null; };
async function inputNames(file: string, access: PropertyCorpusAccess): Promise<readonly string[]> {
    try {
        const children = await access.children(path.join(path.dirname(file), 'inputs'));
        return children.map(function name(child) {
            return child.name;
        });
    } catch (error: unknown) {
        if (error instanceof Error && Reflect.get(error, 'code') === 'ENOENT') {
            return [];
        }
        throw error;
    }
}
async function inputSavedAt(file: string, access: PropertyCorpusAccess): Promise<string> {
    return await access.savedAt(file);
}
async function readSavedInput(
    file: string,
    reference: InputReference,
    access: PropertyCorpusAccess
): Promise<CorpusCache['entries'][number]> {
    const input = inputPath(file, reference.id);
    const entry = parsedWitness(await access.files.read(input));
    if (corpusEntryIdentity(entry) !== reference.id) {
        throw new Error('Corpus input identity differs from its reference.');
    }
    return { id: reference.id, entry, savedAt: reference.savedAt ?? await inputSavedAt(input, access) };
}
async function readCorpusInput(
    file: string,
    reference: InputReference,
    access: PropertyCorpusAccess
): Promise<CorpusCache> {
    try {
        return { entries: [ await readSavedInput(file, reference, access) ], diagnostics: [] };
    } catch (error: unknown) {
        return { entries: [], diagnostics: [ { path: inputPath(file, reference.id), reason: String(error) } ] };
    }
}
async function readCorpusInputs(
    file: string,
    references: readonly InputReference[],
    access: PropertyCorpusAccess
): Promise<CorpusCache> {
    const inputs = await Promise.all(references.map(async function read(reference) {
        return await readCorpusInput(file, reference, access);
    }));
    return {
        entries: inputs.flatMap(function entries(input) {
            return input.entries;
        }),
        diagnostics: inputs.flatMap(function diagnostics(input) {
            return input.diagnostics;
        })
    };
}
async function rebuildCache(file: string, access: PropertyCorpusAccess): Promise<CorpusCache> {
    const names = await inputNames(file, access);
    const references = names
        .filter(function knownInput(name) {
            return /^[a-f0-9]{64}\.json$/u.test(name);
        })
        .toSorted(function alphabetical(left, right) {
            return left.localeCompare(right);
        })
        .map(function reference(name) {
            return { id: name.slice(0, -'.json'.length), savedAt: null };
        });
    return await readCorpusInputs(file, references, access);
}
async function readCacheIndex(file: string, access: PropertyCorpusAccess): Promise<CorpusCache> {
    const source = await access.files.read(file);
    if (source === null) {
        return await rebuildCache(file, access);
    }
    const index = corpusIndexSchema.parse(JSON.parse(source));
    return await readCorpusInputs(file, index.entries, access);
}
export async function loadCorpusCache(file: string, access: PropertyCorpusAccess): Promise<CorpusCache> {
    try {
        return await readCacheIndex(file, access);
    } catch (error: unknown) {
        const recovered = await rebuildCache(file, access);
        return { ...recovered, diagnostics: [ { path: file, reason: String(error) }, ...recovered.diagnostics ] };
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
    const checkedIn = await Promise.all(paths.map(async function readEntry(file) {
        return await readCheckedInEntry(file, access);
    }));
    const cache = await loadCorpusCache(cachePath(directory, profile), access);
    return {
        checkedIn,
        localCache: cache.entries.map(function cachedInput(entry) {
            return entry.entry;
        }),
        diagnostics: cache.diagnostics
    };
}

async function pruneOwnedInputs(
    file: string,
    entries: CorpusCache['entries'],
    access: PropertyCorpusAccess
): Promise<void> {
    const identities = new Set(entries.map(function identity(input) {
        return input.id;
    }));
    const stored = await rebuildCache(file, access);
    for (const input of stored.entries) {
        if (!identities.has(input.id)) {
            await access.remove(inputPath(file, input.id));
        }
    }
}
function recoverableIndex(source: string): unknown {
    try {
        return JSON.parse(source);
    } catch {
        return null;
    }
}
async function checkIndexOverwrite(file: string, access: PropertyCorpusAccess): Promise<void> {
    const source = await access.files.read(file);
    const index = source === null ? null : recoverableIndex(source);
    if (index !== null) {
        corpusIndexSchema.parse(index);
    }
}
async function publishCache(
    file: string,
    entries: CorpusCache['entries'],
    access: PropertyCorpusAccess
): Promise<void> {
    await checkIndexOverwrite(file, access);
    const store = access.files;
    for (const input of entries) {
        await store.write(inputPath(file, input.id), JSON.stringify(input.entry));
    }
    await store.write(
        file,
        JSON.stringify({
            version: 1,
            entries: entries.map(function reference(input) {
                return { id: input.id, savedAt: input.savedAt };
            })
        })
    );
    await pruneOwnedInputs(file, entries, access);
}
async function commitCache(
    file: string,
    policy: PropertyCorpusPolicy,
    entries: readonly PropertyWitnessFile[],
    access: PropertyCorpusAccess
): Promise<readonly CorpusDiagnostic[]> {
    const next = boundedCorpusCache(await loadCorpusCache(file, access), entries, { file, policy, now: access.now() });
    if (next.entries !== null) {
        await publishCache(file, next.entries, access);
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
        remove: rm,
        async savedAt(file) {
            const metadata = await stat(file);
            return metadata.mtime.toISOString();
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

export async function readCorpusCache(file: string): Promise<CorpusCache> {
    return await loadCorpusCache(file, nativeCorpusAccess());
}
