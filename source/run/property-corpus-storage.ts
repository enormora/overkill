import { createHash } from 'node:crypto';
import { mkdir, readdir, stat, rm } from 'node:fs/promises';
import path from 'node:path';
import lockfile from 'proper-lockfile';
import { z } from 'zod/v4';
import type { PropertyCorpusSnapshot } from '../engine/property-corpus.ts';
import { createNodeFileStore } from '../file-store.ts';
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

function cachePath(directory: string, profile: string): string {
    const identity = createHash('sha256').update(profile).digest('hex');
    return path.join(directory, 'corpus', identity, 'index.json');
}

async function entryPaths(target: string): Promise<readonly string[]> {
    const metadata = await stat(target);
    if (!metadata.isDirectory()) {
        return [ target ];
    }
    const entries = await readdir(target, { withFileTypes: true });
    const paths = await Promise.all(entries.map(async function discover(entry) {
        const child = path.join(target, entry.name);
        if (entry.isDirectory()) {
            return await entryPaths(child);
        }
        return entry.isFile() && entry.name.endsWith('.json') ? [ child ] : [];
    }));
    return paths.flat();
}

function parsedWitness(content: string | null): PropertyWitnessFile {
    return propertyWitnessSchema.parse(JSON.parse(content ?? 'null'));
}

async function readCheckedInEntry(file: string): Promise<PropertyWitnessFile> {
    try {
        return parsedWitness(await createNodeFileStore().read(file));
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
async function inputNames(file: string): Promise<readonly string[]> {
    try {
        return await readdir(path.join(path.dirname(file), 'inputs'));
    } catch (error: unknown) {
        if (error instanceof Error && Reflect.get(error, 'code') === 'ENOENT') {
            return [];
        }
        throw error;
    }
}
async function inputSavedAt(file: string): Promise<string> {
    const metadata = await stat(file);
    return metadata.mtime.toISOString();
}
async function readSavedInput(file: string, reference: InputReference): Promise<CorpusCache['entries'][number]> {
    const input = inputPath(file, reference.id);
    const entry = parsedWitness(await createNodeFileStore().read(input));
    if (corpusEntryIdentity(entry) !== reference.id) {
        throw new Error('Corpus input identity differs from its reference.');
    }
    return { id: reference.id, entry, savedAt: reference.savedAt ?? await inputSavedAt(input) };
}
async function readCorpusInput(file: string, reference: InputReference): Promise<CorpusCache> {
    try {
        return { entries: [ await readSavedInput(file, reference) ], diagnostics: [] };
    } catch (error: unknown) {
        return { entries: [], diagnostics: [ { path: inputPath(file, reference.id), reason: String(error) } ] };
    }
}
async function readCorpusInputs(file: string, references: readonly InputReference[]): Promise<CorpusCache> {
    const inputs = await Promise.all(references.map(async function read(reference) {
        return await readCorpusInput(file, reference);
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
async function rebuildCache(file: string): Promise<CorpusCache> {
    const names = await inputNames(file);
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
    return await readCorpusInputs(file, references);
}
async function readCacheIndex(file: string): Promise<CorpusCache> {
    const source = await createNodeFileStore().read(file);
    if (source === null) {
        return await rebuildCache(file);
    }
    const index = corpusIndexSchema.parse(JSON.parse(source));
    return await readCorpusInputs(file, index.entries);
}
export async function readCorpusCache(file: string): Promise<CorpusCache> {
    try {
        return await readCacheIndex(file);
    } catch (error: unknown) {
        const recovered = await rebuildCache(file);
        return { ...recovered, diagnostics: [ { path: file, reason: String(error) }, ...recovered.diagnostics ] };
    }
}

export async function readPropertyCorpus(
    projectRoot: string,
    directory: string,
    profile: string,
    policy: PropertyCorpusPolicy
): Promise<PropertyCorpusSnapshot> {
    const files = await Promise.all(policy.checkedIn.map(async function discover(target) {
        return await entryPaths(path.resolve(projectRoot, target));
    }));
    const paths = Array.from(new Set(files.flat())).toSorted(function alphabetic(left, right) {
        return left.localeCompare(right);
    });
    const checkedIn = await Promise.all(paths.map(readCheckedInEntry));
    const cache = await readCorpusCache(cachePath(directory, profile));
    return {
        checkedIn,
        localCache: cache.entries.map(function input(entry) {
            return entry.entry;
        }),
        diagnostics: cache.diagnostics
    };
}

async function pruneOwnedInputs(file: string, entries: CorpusCache['entries']): Promise<void> {
    const identities = new Set(entries.map(function identity(input) {
        return input.id;
    }));
    const stored = await rebuildCache(file);
    for (const input of stored.entries) {
        if (!identities.has(input.id)) {
            await rm(inputPath(file, input.id));
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
async function checkIndexOverwrite(file: string): Promise<void> {
    const source = await createNodeFileStore().read(file);
    const index = source === null ? null : recoverableIndex(source);
    if (index !== null) {
        corpusIndexSchema.parse(index);
    }
}
async function publishCache(file: string, entries: CorpusCache['entries']): Promise<void> {
    await checkIndexOverwrite(file);
    const store = createNodeFileStore();
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
    await pruneOwnedInputs(file, entries);
}
async function commitCache(
    file: string,
    policy: PropertyCorpusPolicy,
    entries: readonly PropertyWitnessFile[]
): Promise<readonly CorpusDiagnostic[]> {
    const now = new Date();
    const next = boundedCorpusCache(await readCorpusCache(file), entries, { file, policy, now: now.toISOString() });
    if (next.entries !== null) {
        await publishCache(file, next.entries);
    }
    return next.diagnostics;
}

export async function savePropertyCorpus(
    directory: string,
    profile: string,
    policy: PropertyCorpusPolicy,
    entries: readonly PropertyWitnessFile[]
): Promise<readonly CorpusDiagnostic[]> {
    if (entries.length === 0) {
        return [];
    }
    const file = cachePath(directory, profile);
    const parent = path.dirname(file);
    await mkdir(parent, { recursive: true });
    const release = await lockfile.lock(parent, { retries: { retries: 50, minTimeout: 25, maxTimeout: 100 } });
    try {
        return await commitCache(file, policy, entries);
    } finally {
        await release();
    }
}
