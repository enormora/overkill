import type { CompositeAssertionReturn } from '@overkill-dev/test/assert';
import type { ParameterizedTestScope } from '@overkill-dev/test';
import { type CompositeCheckBuilder } from '@overkill-dev/test/assert';
import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { table, type TestScope, suite } from '@overkill-dev/test';

import { z } from 'zod';
import { currentRunRecordVersion } from '../../run/run-record-format.ts';
import { createHistory, normalizeConfig, type SingleRunRecord } from '../../packages/run/run.entry-point.ts';

const binary = fileURLToPath(new URL('../../packages/test/overkill.entry-point.ts', import.meta.url));
const engineUrl = new URL('../../packages/engine/engine.entry-point.ts', import.meta.url);
const authoringUrl = new URL('../../packages/test/test.entry-point.ts', import.meta.url);

type ExecutionMode = 'in-process' | 'supervised-process' | 'worker-pool';

async function createRecordedProject(cleanup: TestScope['cleanup'], processModel: ExecutionMode): Promise<string> {
    const directory = await mkdtemp(path.join(tmpdir(), 'overkill-record-policy-'));
    cleanup(async function removeProject() {
        await rm(directory, { recursive: true, force: true });
    });
    const config = {
        reporters: [],
        profiles: {
            tests: {
                testFamily: processModel === 'worker-pool' ? 'integration' : 'microtest',
                files: { include: [ 'case.test.ts' ] },
                timeouts: { collectionMilliseconds: 30_000, softMilliseconds: 5000, hardMilliseconds: 10_000 },
                execution: {
                    processModel,
                    scheduling: 'serial',
                    maxConcurrency: 1,
                    ...processModel === 'worker-pool' ? { maxWorkers: 1 } : {}
                }
            }
        }
    };
    await writeFile(
        path.join(directory, 'overkill.config.ts'),
        `import { defineReporter } from ${JSON.stringify(engineUrl.href)};
const reporter = defineReporter(() => ({
    kind: 'real-time', name: 'record-policy', dispose: null, onEvent() {},
    onFinish: null, sinks: [ { kind: 'memory' } ]
}));
export const config = { ...${JSON.stringify(config)}, reporters: [ reporter ] };`
    );
    await writeFile(
        path.join(directory, 'case.test.ts'),
        `
import { readdirSync, readFileSync } from 'node:fs';
import { test } from ${JSON.stringify(authoringUrl.href)};
const recordFolder = new URL('./.overkill/runs/', import.meta.url);
const recordFiles = readdirSync(recordFolder);
if (recordFiles.length !== 1) throw new Error('Expected a record before importing tests.');
const record = JSON.parse(readFileSync(new URL(recordFiles[0], recordFolder), 'utf8'));
if (record.status !== 'started') throw new Error('Expected an active record while importing tests.');
export const testNode = test('persisted case', (scope) => {
    scope.assert.equal(4, 4);
    return scope.assert.collect();
});
`
    );
    return directory;
}

async function executeOverkill(directory: string): Promise<void> {
    await new Promise<void>(function execute(resolve, reject) {
        execFile(process.execPath, [ binary, 'run', '--profile', 'tests', '--record' ], {
            cwd: directory,
            timeout: 60_000
        }, function completed(error: Error | null) {
            if (error === null) {
                resolve();
            } else {
                reject(error);
            }
        });
    });
}

async function readSingleRunRecords(directory: string): Promise<readonly SingleRunRecord[]> {
    const folder = path.join(directory, '.overkill', 'runs');
    const entries = await readdir(folder);
    const names = entries.filter(function recordFile(name) {
        return name.endsWith('.json');
    });
    return await Promise.all(names.map(async function readRecord(name) {
        return JSON.parse(await readFile(path.join(folder, name), 'utf8')) as SingleRunRecord;
    }));
}

const assertCompletedRecord = defineCompositeAssertion({
    name: 'completed record',
    assert(check, record: SingleRunRecord) {
        const { facts } = record;
        if (facts === null) {
            throw new Error('Completed execution requires run facts.');
        }
        return check.group([
            check.equal(record.status, 'completed'),
            check.equal(record.result?.status, 'passed'),
            check.equal(facts.execution.runRecords.persist, true),
            check.deepEqual(facts.execution.runRecords.reasons, [ 'request' ]),
            check.equal(record.request.record, true)
        ]);
    }
});

async function executeRunCommand(directory: string, args: readonly string[]): Promise<number> {
    return await new Promise<number>(function execute(resolve, reject) {
        execFile(process.execPath, [ binary, ...args, '--profile', 'tests' ], {
            cwd: directory,
            timeout: 60_000
        }, function completed(error) {
            if (error === null) {
                resolve(0);
            } else if (typeof error.code === 'number') {
                resolve(error.code);
            } else {
                reject(new Error('Command execution failed.', { cause: error }));
            }
        });
    });
}

async function writeLastFailedCase(directory: string, passing: boolean): Promise<void> {
    await writeFile(
        path.join(directory, 'case.test.ts'),
        `
import { test } from ${JSON.stringify(authoringUrl.href)};
export const testNode = test('persisted case', (scope) => {
    scope.assert.equal(${String(passing)}, true);
    return scope.assert.collect();
});
`
    );
}

const assertLastFailedRecords = defineCompositeAssertion({
    name: 'last failed records',
    async assert(check, directory: string) {
        const folder = path.join(directory, '.overkill', 'runs');
        const entries = await readdir(folder);
        const names = entries.filter(function recordFile(name) {
            return name.endsWith('.json');
        });
        const records = await Promise.all(names.map(async function readRecord(name) {
            return z
                .object({ result: z.object({ planStatus: z.string(), summary: z.object({ planned: z.number() }) }) })
                .parse(JSON.parse(await readFile(path.join(folder, name), 'utf8')));
        }));
        return check.group([
            check.equal(records.length, 3),
            check.equal(
                records
                    .filter(function empty(record) {
                        return record.result.planStatus === 'empty-selection';
                    })
                    .length,
                1
            ),
            check.deepEqual(
                records
                    .map(function planned(record) {
                        return record.result.summary.planned;
                    })
                    .toSorted(function ascending(left, right) {
                        return left - right;
                    }),
                [ 0, 1, 1 ]
            )
        ]);
    }
});

const sharedSelectionChecks = (
    check: CompositeCheckBuilder<'assert'>,
    empty: SingleRunRecord,
    executed: SingleRunRecord
): CompositeAssertionReturn<'assert'> => {
    if (empty.facts === undefined || empty.facts === null) {
        return check.defined(empty.facts);
    }
    if (executed.facts === undefined || executed.facts === null) {
        return check.defined(executed.facts);
    }
    if (
        empty.facts.reproducibility.selectedIdentities === undefined ||
        empty.facts.reproducibility.selectedIdentities === null
    ) {
        return check.defined(empty.facts.reproducibility.selectedIdentities);
    }
    if (
        executed.facts.reproducibility.selectedIdentities === undefined ||
        executed.facts.reproducibility.selectedIdentities === null
    ) {
        return check.defined(executed.facts.reproducibility.selectedIdentities);
    }
    return check.group([
        check.deepEqual(empty.facts.reproducibility.selectedIdentities, executed.identities),
        check.deepEqual(executed.facts.reproducibility.selectedIdentities, executed.identities)
    ]);
};

const shardSelectionChecks = (
    check: CompositeCheckBuilder<'assert'>,
    empty: SingleRunRecord,
    executed: SingleRunRecord
): CompositeAssertionReturn<'assert'> => {
    const initialChecks = check.group([
        check.equal(empty.version, currentRunRecordVersion),
        check.equal(executed.version, currentRunRecordVersion)
    ]);
    if (empty.replayPlan === undefined || empty.replayPlan === null) {
        return check.group([ initialChecks, check.defined(empty.replayPlan) ]);
    }
    const intermediateChecks = check.defined(empty.replayPlan);
    if (executed.replayPlan === undefined || executed.replayPlan === null) {
        return check.group([ initialChecks, intermediateChecks, check.defined(executed.replayPlan) ]);
    }
    return check.group([
        initialChecks,
        intermediateChecks,
        check.defined(executed.replayPlan),
        sharedSelectionChecks(check.annotated('shared selection'), empty, executed),
        check.notEqual(empty.id, executed.id),
        check.notEqual(empty.request.shard.index, executed.request.shard.index),
        check.deepEqual(empty.request.selection, executed.request.selection),
        check.equal(executed.replayPlan.discoveredFiles[0]?.cases.length, 1),
        check.deepEqual(empty.replayPlan.discoveredFiles, executed.replayPlan.discoveredFiles)
    ]);
};

const shardOutcomeChecks = (
    check: CompositeCheckBuilder<'assert'>,
    record: SingleRunRecord,
    status: 'failed' | 'passed',
    planned: number
): CompositeAssertionReturn<'assert'> => {
    if (record.facts === undefined || record.facts === null) {
        return check.defined(record.facts);
    }
    if (record.result === undefined || record.result === null) {
        return check.defined(record.result);
    }
    return check.group([ check.deepEqual({
        recordStatus: record.status,
        resultStatus: record.result.status,
        identities: record.identities.length,
        reasons: record.facts.execution.runRecords.reasons,
        seed: record.seed
    }, { recordStatus: 'completed', resultStatus: status, identities: planned, reasons: [ 'merge' ], seed: '42' }) ]);
};

const assertShardRecords = defineCompositeAssertion({
    name: 'shard records',
    async assert(check, directory: string) {
        const records = await readSingleRunRecords(directory);
        const shards = records.filter(function mergeInput(record) {
            return record.request.recordForMerge;
        });
        const empty = shards.find(function emptyShard(record) {
            return record.result?.planStatus === 'empty-shard';
        });
        const executed = shards.find(function executedShard(record) {
            return record.result?.perTest.length === 1;
        });
        if (empty === undefined || empty === null) {
            return check.defined(empty);
        }
        const initialChecks = check.defined(empty);
        if (executed === undefined || executed === null) {
            return check.group([ initialChecks, check.defined(executed) ]);
        }
        return check.group([
            initialChecks,
            check.defined(executed),
            check.deepEqual({ records: records.length, shards: shards.length }, { records: 3, shards: 2 }),
            shardOutcomeChecks(check.annotated('shard outcome'), empty, 'passed', 0),
            shardOutcomeChecks(check.annotated('shard outcome'), executed, 'failed', 1),
            shardSelectionChecks(
                check.annotated('shard selection'),
                empty,
                executed
            )
        ]);
    }
});

async function readHistorySnapshot(directory: string): Promise<string> {
    return await readFile(path.join(directory, '.overkill', 'history', 'index.json'), 'utf8');
}

const assertShardExitCodes = defineCompositeAssertion({
    name: 'shard exit codes',
    async assert(check, directory: string) {
        const exitCodes: number[] = [];
        for (const shard of [ '1/2', '2/2' ]) {
            exitCodes.push(
                await executeRunCommand(directory, [
                    'run',
                    '--shard',
                    shard,
                    '--seed',
                    '42',
                    '--title',
                    'persisted',
                    '--record-for-merge'
                ])
            );
        }
        return check.group([ check.deepEqual(
            exitCodes.toSorted(function ascending(left, right) {
                return left - right;
            }),
            [ 0, 1 ]
        ) ]);
    }
});

const assertRetainedHistory = defineCompositeAssertion({
    name: 'retained history',
    async assert(check, directory: string) {
        const history = createHistory({ projectRoot: directory, config: normalizeConfig({}) });
        const repaired = await history.compact();
        const listed = await history.list();
        const pruning = await history.prune({ dryRun: true });
        return check.group([ check.deepEqual({
            rebuilt: repaired.rebuiltRunCount,
            summaries: listed.length,
            pruned: pruning.paths
        }, { rebuilt: 1, summaries: 1, pruned: [] }) ]);
    }
});

export const testNode = suite(
    'run recording across execution boundaries',
    [
        table({
            title: 'records run outcomes and last-failed selections',
            cases: ([ 'in-process', 'supervised-process', 'worker-pool' ] as const).flatMap(
                function executionMode(mode) {
                    return { caseDescription: mode, mode };
                }
            ),
            caseTitle(row) {
                return row.caseDescription;
            },
            async test(
                scope: ParameterizedTestScope<
                    {
                        readonly caseDescription: 'in-process' | 'supervised-process' | 'worker-pool';
                        readonly mode: 'in-process' | 'supervised-process' | 'worker-pool';
                    }
                >
            ) {
                const { mode } = scope.parameters;
                const recordedExecutionDirectory = await createRecordedProject(scope.cleanup, mode);
                await executeOverkill(recordedExecutionDirectory);
                const recordedExecutionRecords = await readSingleRunRecords(recordedExecutionDirectory);
                scope.assert.equal(recordedExecutionRecords.length, 1);
                const [ record ] = recordedExecutionRecords;
                scope.require.defined(record);
                scope.assert(assertCompletedRecord, record);
                const lastFailedExecutionDirectory = await createRecordedProject(scope.cleanup, mode);
                await writeLastFailedCase(lastFailedExecutionDirectory, false);
                scope.assert.equal(await executeRunCommand(lastFailedExecutionDirectory, [ 'run', '--record' ]), 1);
                await writeLastFailedCase(lastFailedExecutionDirectory, true);
                scope.assert.equal(
                    await executeRunCommand(lastFailedExecutionDirectory, [ 'run', '--last-failed' ]),
                    0
                );
                scope.assert.equal(
                    await executeRunCommand(lastFailedExecutionDirectory, [ 'run', '--last-failed' ]),
                    0
                );
                await scope.assert(assertLastFailedRecords, lastFailedExecutionDirectory);

                return scope.assert.collect();
            }
        }),
        table({
            title: 'persists merge inputs without publishing shard history',
            cases: ([ 'in-process', 'supervised-process', 'worker-pool' ] as const).flatMap(
                function executionMode(mode) {
                    return { mode };
                }
            ),
            caseTitle({ mode }) {
                return [ mode ].map(String).join(', ');
            },
            async test(scope) {
                const { mode } = scope.parameters;
                const shardExecutionDirectory = await createRecordedProject(scope.cleanup, mode);
                await writeLastFailedCase(shardExecutionDirectory, true);
                scope.assert.equal(await executeRunCommand(shardExecutionDirectory, [ 'run', '--record' ]), 0);
                const shardExecutionBefore = await readHistorySnapshot(shardExecutionDirectory);
                await writeLastFailedCase(shardExecutionDirectory, false);
                await scope.assert(assertShardExitCodes, shardExecutionDirectory);
                await scope.assert(assertShardRecords, shardExecutionDirectory);
                scope.assert.equal(await readHistorySnapshot(shardExecutionDirectory), shardExecutionBefore);
                await scope.assert(assertRetainedHistory, shardExecutionDirectory);

                return scope.assert.collect();
            }
        })
    ]
);
