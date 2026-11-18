import { propertyWitnessSchema } from '../engine/witness-file.ts';
import { createCorpusOperations, type CorpusOperations } from '../run/corpus.ts';
import { corpusIndexSchema } from '../run/property-corpus-storage.ts';
import { loadCorpusEntries, type CorpusSourceAccess } from '../run/corpus-source.ts';
import type { CorpusRequest, CorpusWriteRequest, CorpusWritePreview } from '../run/corpus-types.ts';
import { propertyCorpusEntry } from './property-corpus.ts';

export const corpusWitness = propertyWitnessSchema.parse(propertyCorpusEntry);
export function corpusIndex(ids: readonly string[]): string {
    return JSON.stringify({
        version: 1,
        entries: ids.map(function (id) {
            return { id, savedAt: '2026-11-01T00:00:00.000Z' };
        })
    });
}
export function corpusSource(content: string): CorpusSourceAccess {
    return {
        async readFile() {
            return content;
        },
        async readCache() {
            const index = corpusIndexSchema.parse(JSON.parse(content));
            return {
                entries: index.entries.map(function entry(reference) {
                    return { ...reference, entry: corpusWitness };
                }),
                diagnostics: []
            };
        }
    };
}
export const corpusRequest: CorpusRequest = {
    cwd: '/project',
    source: { kind: 'path', path: 'input.json' },
    codec: { kind: 'built-in' }
};
export type CorpusOperationFaults = {
    readonly read: Error | null;
    readonly inspect: Error | null;
    readonly create: Error | null;
    readonly preview: Error | null;
};
export const corpusOperationFaults: CorpusOperationFaults = { read: null, inspect: null, create: null, preview: null };
type CorpusOperationsFixture = {
    readonly operations: CorpusOperations;
    readonly request: CorpusWriteRequest;
    readonly calls: readonly string[];
    readonly files: ReadonlyMap<string, string>;
    readonly previews: readonly CorpusWritePreview[];
};
export function corpusOperations(
    content: string,
    faults: CorpusOperationFaults
): CorpusOperationsFixture {
    const calls: string[] = [];
    const files = new Map<string, string>();
    const previews: CorpusWritePreview[] = [];
    const operations = createCorpusOperations({
        async read(request) {
            return await loadCorpusEntries(request, {
                ...corpusSource(content),
                async readFile(target) {
                    calls.push(`read:${target}`);
                    if (faults.read !== null) {
                        throw faults.read;
                    }
                    return content;
                }
            });
        },
        async inspect(_request, witness, migrate) {
            calls.push(`inspect:${migrate}`);
            if (faults.inspect !== null) {
                throw faults.inspect;
            }
            return {
                witness,
                source: { kind: 'string', value: 'original', truncation: null },
                output: { kind: 'string', value: 'decoded', truncation: null }
            };
        },
        async create(destination, text) {
            calls.push(`create:${destination}`);
            if (faults.create !== null) {
                throw faults.create;
            }
            files.set(destination, text);
        }
    });
    const request: CorpusWriteRequest = {
        ...corpusRequest,
        destination: 'output.json',
        async beforeWrite(preview) {
            calls.push('preview');
            previews.push(preview);
            if (faults.preview !== null) {
                throw faults.preview;
            }
        }
    };
    return { operations, request, calls, files, previews };
}
