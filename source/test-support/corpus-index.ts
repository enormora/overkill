import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PropertyWitnessFile } from '../engine/witness-file.ts';
import { corpusEntryIdentity } from '../run/property-corpus-cache.ts';

export async function writeCorpusIndex(file: string, entries: readonly PropertyWitnessFile[]): Promise<
    readonly string[]
> {
    const directory = path.join(path.dirname(file), 'inputs');
    await mkdir(directory, { recursive: true });
    const references = [];
    for (const entry of entries) {
        const id = corpusEntryIdentity(entry);
        await writeFile(path.join(directory, `${id}.json`), JSON.stringify(entry));
        references.push({ id, savedAt: '2026-09-17T00:00:00.000Z' });
    }
    await writeFile(file, JSON.stringify({ version: 1, entries: references }));
    return references.map(function identity(reference) {
        return reference.id;
    });
}
