import { mkdtemp, mkdtempDisposable, writeFile, mkdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runIfMain } from '#test-runner';
import { mergeRecordFixture } from '../test-support/merge-record-fixture.ts';
import { createSuite, createTestCase } from '../packages/engine/engine.entry-point.ts';
import { defaultRunConfig } from '../test-support/run-command-factory.ts';
import {
    mergeResults,
    RunCollectionError,
    RunResolutionError,
    type NormalizedConfig
} from '../packages/run/run.entry-point.ts';
import { mergeResultsCommand } from './merge-results-command.ts';

async function populateMergeDirectory(directory: string): Promise<void> {
    await writeFile(join(directory, 'second.json'), JSON.stringify(mergeRecordFixture('second', 2, 3)));
    await writeFile(join(directory, 'first.json'), JSON.stringify(mergeRecordFixture('first', 1, 2)));
    await writeFile(join(directory, 'notes.txt'), 'not json');
    await mkdir(join(directory, 'artifacts'));
    await writeFile(join(directory, 'artifacts', 'payload.json'), 'not json');
}

export const testNode = createSuite({
    title: 'merge results inputs and CLI',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [
        createTestCase({
            title: 'rejects a historical input with a regeneration diagnostic through the API and CLI',
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            async body(scope) {
                const directory = await mkdtemp(join(tmpdir(), 'overkill-merge-historical-'));
                try {
                    const historical = structuredClone(mergeRecordFixture('historical', 1, 1));
                    Reflect.deleteProperty(historical.facts.reproducibility, 'selectedIdentities');
                    await writeFile(join(directory, 'historical.json'), JSON.stringify(historical));
                    await scope.assert.rejects(async function historicalMerge() {
                        await mergeResults({
                            config: defaultRunConfig({}),
                            cwd: directory,
                            inputs: [ { kind: 'file', path: 'historical.json' } ]
                        });
                    }, { message: /selected-identities: missing-evidence.*Regenerate shard records/u });
                    const result = await mergeResultsCommand(async function config() {
                        return { ...defaultRunConfig({}), configPath: null };
                    }, { cwd: directory, configPath: null, paths: [ 'historical.json' ] });
                    scope.assert.deepEqual({
                        exitCode: result.exitCode,
                        runResult: result.runResult,
                        regeneration: result.fallbackDiagnostics.some(function regeneration(message) {
                            return message.includes('Regenerate shard records with selection evidence.');
                        })
                    }, { exitCode: 2, runResult: null, regeneration: true });
                    return scope.assert.collect();
                } finally {
                    await rm(directory, { recursive: true, force: true });
                }
            }
        }),
        createTestCase({
            title: 'rejects incompatible inputs through the public API and CLI',
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            async body(scope) {
                const directory = await mkdtemp(join(tmpdir(), 'overkill-merge-conflict-'));
                try {
                    const record = mergeRecordFixture('first', 1, 1);
                    await writeFile(join(directory, 'first.json'), JSON.stringify(record));
                    await writeFile(
                        join(directory, 'second.json'),
                        JSON.stringify({
                            ...record,
                            facts: {
                                ...record.facts,
                                reproducibility: {
                                    ...record.facts.reproducibility,
                                    seed: '999'
                                }
                            }
                        })
                    );
                    await scope.assert.rejects(async function incompatibleMerge() {
                        await mergeResults({
                            config: defaultRunConfig({}),
                            cwd: directory,
                            inputs: [ { kind: 'directory', path: '.' } ]
                        });
                    }, { message: /seed/u });
                    const result = await mergeResultsCommand(async function config() {
                        return { ...defaultRunConfig({}), configPath: null };
                    }, { cwd: directory, configPath: null, paths: [ '.' ] });
                    scope.assert.deepEqual({
                        exitCode: result.exitCode,
                        runResult: result.runResult,
                        diagnostic: result.fallbackDiagnostics.some(function seed(message) {
                            return message.includes('seed');
                        })
                    }, { exitCode: 2, runResult: null, diagnostic: true });
                    return scope.assert.collect();
                } finally {
                    await rm(directory, { recursive: true, force: true });
                }
            }
        }),
        createTestCase({
            title: 'preserves invalid-request errors when an operand has the wrong kind',
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            async body(scope) {
                await using directory = await mkdtempDisposable(join(tmpdir(), 'overkill-merge-kind-'));
                await writeFile(join(directory.path, 'record.json'), JSON.stringify(mergeRecordFixture('first', 1, 2)));
                for (
                    const input of [
                        { kind: 'file', path: '.' },
                        { kind: 'directory', path: 'record.json' }
                    ] as const
                ) {
                    await scope.assert.rejects(async function () {
                        return await mergeResults({
                            config: defaultRunConfig({}),
                            cwd: directory.path,
                            inputs: [ input ]
                        });
                    }, {
                        type: RunResolutionError,
                        message: `Merge input is not a ${input.kind}: ${join(directory.path, input.path)}`
                    });
                }
                return scope.assert.collect();
            }
        }),
        createTestCase({
            title: 'rejects directories without direct JSON records',
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            async body(scope) {
                await using directory = await mkdtempDisposable(join(tmpdir(), 'overkill-merge-empty-'));
                await writeFile(join(directory.path, 'notes.txt'), 'not a run record');
                await scope.assert.rejects(async function () {
                    return await mergeResults({
                        config: defaultRunConfig({}),
                        cwd: directory.path,
                        inputs: [ { kind: 'directory', path: '.' } ]
                    });
                }, {
                    type: RunResolutionError,
                    message: 'Merge results requires at least one run-record file.'
                });
                return scope.assert.collect();
            }
        }),
        createTestCase({
            title: 'reports malformed records as collection errors with the input path',
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            async body(scope) {
                await using directory = await mkdtempDisposable(join(tmpdir(), 'overkill-merge-invalid-'));
                const file = join(directory.path, 'record.json');
                await writeFile(file, '{');
                await scope.assert.rejects(async function () {
                    return await mergeResults({
                        config: defaultRunConfig({}),
                        cwd: directory.path,
                        inputs: [ { kind: 'file', path: 'record.json' } ]
                    });
                }, { type: RunCollectionError, message: `Cannot read merge input: ${await realpath(file)}` });
                return scope.assert.collect();
            }
        }),
        createTestCase({
            title: 'orders equal shard indices by canonical input path',
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            async body(scope) {
                await using directory = await mkdtempDisposable(join(tmpdir(), 'overkill-merge-order-'));
                await writeFile(join(directory.path, 'b.json'), JSON.stringify(mergeRecordFixture('second', 1, 3)));
                await writeFile(join(directory.path, 'a.json'), JSON.stringify(mergeRecordFixture('first', 1, 2)));
                const merged = await mergeResults({
                    config: defaultRunConfig({}),
                    cwd: directory.path,
                    inputs: [ { kind: 'file', path: 'b.json' }, { kind: 'file', path: 'a.json' } ]
                });
                scope.assert.deepEqual(
                    merged.lineage.map(function identity(source) {
                        return source.id;
                    }),
                    [ 'first', 'second' ]
                );
                scope.assert.equal(merged.result.summary.passed, 5);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            title: 'maps missing operands and unreadable inputs to CLI diagnostics',
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            async body(scope) {
                const loadConfig = async function config(): Promise<
                    NormalizedConfig & { readonly configPath: null; }
                > {
                    return { ...defaultRunConfig({}), configPath: null };
                };
                const missing = await mergeResultsCommand(loadConfig, {
                    cwd: process.cwd(),
                    configPath: null,
                    paths: []
                });
                const unreadable = await mergeResultsCommand(loadConfig, {
                    cwd: process.cwd(),
                    configPath: null,
                    paths: [ 'absent-merge-record.json' ]
                });
                scope.assert.equal(missing.exitCode, 3);
                scope.assert.equal(unreadable.exitCode, 2);
                scope.assert.equal(unreadable.fallbackDiagnostics.length, 1);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            title: 'reads direct JSON children, coalesces file operands, and preserves ordered lineage',
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            async body(scope) {
                const directory = await mkdtemp(join(tmpdir(), 'overkill-merge-'));
                try {
                    await populateMergeDirectory(directory);
                    const merged = await mergeResults({
                        config: defaultRunConfig({}),
                        cwd: directory,
                        inputs: [ { kind: 'directory', path: '.' }, { kind: 'file', path: 'first.json' } ]
                    });

                    scope.assert.deepEqual(
                        merged.lineage.map(function id(source) {
                            return source.id;
                        }),
                        [ 'first', 'second' ]
                    );
                    scope.assert.equal(merged.result.summary.passed, 5);
                    scope.assert.deepEqual(merged.runtime, [ null, null ]);

                    return scope.assert.collect();
                } finally {
                    await rm(directory, { recursive: true, force: true });
                }
            }
        })
    ]
});
await runIfMain(import.meta, testNode);
