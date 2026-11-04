import path from 'node:path';
import { createNodeFileStore } from '../file-store.ts';
import { readCorpusEntries, type CorpusCandidate } from './corpus-source.ts';
import { inspectCorpusInput } from './corpus-codec.ts';
import {
    CorpusOperationError,
    type CorpusEntryInspection,
    type CorpusRequest,
    type CorpusInspection,
    type CorpusWriteRequest,
    type CorpusWriteResult
} from './corpus-types.ts';

const indentation = 2;

async function inspectCandidate(
    request: CorpusRequest,
    candidate: CorpusCandidate
): Promise<CorpusEntryInspection> {
    const decoded = await inspectCorpusInput(request, candidate.entry, false);
    return {
        entryId: candidate.id,
        witness: decoded.witness,
        preview: decoded.output
    };
}

async function deliverPreview(
    request: CorpusWriteRequest,
    preview: Parameters<CorpusWriteRequest['beforeWrite']>[0]
): Promise<void> {
    try {
        await request.beforeWrite(structuredClone(preview));
    } catch (error: unknown) {
        throw new CorpusOperationError('Corpus preview delivery failed.', { cause: error }, 'preview-delivery');
    }
}

async function publish(destination: string, content: string): Promise<void> {
    try {
        await createNodeFileStore().create(destination, content);
    } catch (error: unknown) {
        const code = error instanceof Error && Reflect.get(error, 'code') === 'EEXIST'
            ? 'destination-conflict'
            : 'filesystem';
        throw new CorpusOperationError('Cannot create corpus destination.', { cause: error }, code);
    }
}

async function publishCandidate(
    request: CorpusWriteRequest,
    candidate: CorpusCandidate,
    migrate: boolean
): Promise<CorpusWriteResult> {
    const destination = path.resolve(request.cwd, request.destination);
    if (destination === path.resolve(request.cwd, request.source.path)) {
        throw new CorpusOperationError('Source and destination must differ.', { cause: null }, 'destination-conflict');
    }
    const decoded = await inspectCorpusInput(request, candidate.entry, migrate);
    const entryId = candidate.id;
    const entry = { entryId, witness: decoded.witness, preview: decoded.output };
    const content = `${JSON.stringify(decoded.witness, null, indentation)}\n`;
    await deliverPreview(request, {
        source: { entryId, witness: candidate.entry, preview: decoded.source },
        output: entry
    });
    await publish(destination, content);
    return { destination, entry };
}

async function writeCorpus(request: CorpusWriteRequest, migrate: boolean): Promise<CorpusWriteResult> {
    const source = await readCorpusEntries(request);
    const [ candidate ] = source.entries;
    if (
        candidate === undefined || source.entries.length !== 1 ||
        request.source.kind === 'path' && candidate.id !== null
    ) {
        throw new CorpusOperationError(
            'Writing requires one witness or an explicit cache entry.',
            { cause: null },
            'selection'
        );
    }
    return await publishCandidate(request, candidate, migrate);
}

export async function inspectCorpus(request: CorpusRequest): Promise<CorpusInspection> {
    const source = await readCorpusEntries(request);
    const entries = [];
    const diagnostics = Array.from(source.diagnostics);
    for (const candidate of source.entries) {
        try {
            entries.push(await inspectCandidate(request, candidate));
        } catch (error: unknown) {
            if (request.source.kind === 'cache-entry' || candidate.id === null) {
                throw error;
            }
            diagnostics.push(`${candidate.id}: ${String(error)}`);
        }
    }
    return { sourcePath: path.resolve(request.cwd, request.source.path), entries, diagnostics };
}

export async function promoteWitness(request: CorpusWriteRequest): Promise<CorpusWriteResult> {
    return await writeCorpus(request, false);
}

export async function migrateCorpus(request: CorpusWriteRequest): Promise<CorpusWriteResult> {
    return await writeCorpus(request, true);
}
