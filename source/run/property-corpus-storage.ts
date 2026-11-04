import { createHash } from 'node:crypto';
import { mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import lockfile from 'proper-lockfile';
import type { PropertyCorpusSnapshot } from '../engine/property-corpus.ts';
import { createNodeFileStore } from '../file-store.ts';
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

async function readCache(file: string): Promise<CorpusCache> {
    try {
        return parseCorpusCache(await createNodeFileStore().read(file), file);
    } catch (error: unknown) {
        return { entries: [], diagnostics: [ { path: file, reason: String(error) } ] };
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
    const cache = await readCache(cachePath(directory, profile));
    return {
        checkedIn,
        localCache: cache.entries.map(function input(entry) {
            return entry.entry;
        }),
        diagnostics: cache.diagnostics
    };
}

async function commitCache(
    file: string,
    policy: PropertyCorpusPolicy,
    entries: readonly PropertyWitnessFile[]
): Promise<readonly CorpusDiagnostic[]> {
    const now = new Date();
    const next = boundedCorpusCache(await readCache(file), entries, { file, policy, now: now.toISOString() });
    if (next.content !== null) {
        await createNodeFileStore().write(file, next.content);
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
