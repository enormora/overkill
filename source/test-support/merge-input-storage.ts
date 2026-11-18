import path from 'node:path';
import type { MergeInputAccess } from '../run/merge-results-input.ts';
import type { MergeResultsCommand } from '../run/merge-results-types.ts';
import { defaultRunConfig } from './run-command-factory.ts';
import { mergeRecordFixture } from './merge-record-fixture.ts';

type MergeInputStorage = {
    readonly access: MergeInputAccess;
    readonly command: MergeResultsCommand;
    readonly seed: (file: string, content: string) => void;
    readonly alias: (file: string, target: string) => void;
};
const secondShard = 2;
export function mergeInputStorage(): MergeInputStorage {
    const files = new Map<string, string>([ [
        '/records/first.json',
        JSON.stringify(mergeRecordFixture('first', 1, 1))
    ], [ '/records/second.json', JSON.stringify(mergeRecordFixture('second', secondShard, secondShard)) ] ]);
    const aliases = new Map<string, string>();
    return {
        command: { cwd: '/', config: defaultRunConfig({}), inputs: [ { kind: 'directory', path: 'records' } ] },
        seed(file, content) {
            files.set(file, content);
        },
        alias(file, target) {
            aliases.set(file, target);
        },
        access: {
            async inspect(file) {
                if (files.has(file) || aliases.has(file)) {
                    return 'file';
                }
                if (file === '/records') {
                    return 'directory';
                }
                throw new Error('missing input');
            },
            async canonical(file) {
                return aliases.get(file) ?? file;
            },
            async children(directory) {
                return [
                    ...Array.from(files.keys(), function (file) {
                        return { name: path.relative(directory, file), file: true };
                    }),
                    { name: 'artifacts', file: false }
                ];
            },
            async read(file) {
                const content = files.get(file);
                if (content === undefined) {
                    throw new Error('missing file');
                }
                return content;
            }
        }
    };
}
export function mergedInputDocument(): string {
    const record = mergeRecordFixture('merged', 1, 1);
    return JSON.stringify({
        ...record,
        kind: 'merged',
        startedAt: '2026-10-30T00:00:00.000Z',
        lineage: [ { id: 'first', path: 'first.json' } ],
        runtime: [ null ],
        versions: { engine: null, packages: {} }
    });
}
