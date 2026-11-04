import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { runIfMain } from '#test-runner';
import type { RunRecord } from '../../packages/run/run.entry-point.ts';
import { suite, test, type TestScope } from '../../packages/test/test.entry-point.ts';

const binary = fileURLToPath(new URL('../../packages/test/overkill.entry-point.ts', import.meta.url));
const engineUrl = new URL('../../packages/engine/engine.entry-point.ts', import.meta.url);
const authoringUrl = new URL('../../packages/test/test.entry-point.ts', import.meta.url);

type ExecutionMode = 'in-process' | 'supervised-process' | 'worker-pool';

async function createRecordedProject(scope: TestScope, processModel: ExecutionMode): Promise<string> {
    const directory = await mkdtemp(path.join(tmpdir(), 'overkill-record-policy-'));
    scope.cleanup(async function removeProject() {
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

async function readRunRecord(directory: string): Promise<RunRecord> {
    const folder = path.join(directory, '.overkill', 'runs');
    const entries = await readdir(folder);
    const names = entries.filter(function recordFile(name) {
        return name.endsWith('.json');
    });
    const [ name ] = names;
    if (names.length !== 1 || name === undefined) {
        throw new Error('Expected one run record.');
    }
    return JSON.parse(await readFile(path.join(folder, name), 'utf8')) as RunRecord;
}

function assertCompletedRecord(scope: TestScope, record: RunRecord): void {
    const { facts } = record;
    if (facts === null) {
        throw new Error('Completed execution requires run facts.');
    }
    scope.assert.equal(record.status, 'completed');
    scope.assert.equal(record.result?.status, 'passed');
    scope.assert.equal(facts.execution.runRecords.persist, true);
    scope.assert.deepEqual(facts.execution.runRecords.reasons, [ 'request' ]);
    scope.assert.equal(record.request.record, true);
}

async function assertRecordedExecution(scope: TestScope, processModel: ExecutionMode): Promise<void> {
    const directory = await createRecordedProject(scope, processModel);
    await executeOverkill(directory);
    const record = await readRunRecord(directory);
    assertCompletedRecord(scope, record);
}

async function executeLastFailedCommand(directory: string, args: readonly string[]): Promise<number> {
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

async function assertLastFailedRecords(scope: TestScope, directory: string): Promise<void> {
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
    scope.assert.equal(records.length, 3);
    scope.assert.equal(
        records
            .filter(function empty(record) {
                return record.result.planStatus === 'empty-selection';
            })
            .length,
        1
    );
    scope.assert.deepEqual(
        records
            .map(function planned(record) {
                return record.result.summary.planned;
            })
            .toSorted(function ascending(left, right) {
                return left - right;
            }),
        [ 0, 1, 1 ]
    );
}

async function assertLastFailedExecution(scope: TestScope, mode: ExecutionMode): Promise<void> {
    const directory = await createRecordedProject(scope, mode);
    await writeLastFailedCase(directory, false);
    scope.assert.equal(await executeLastFailedCommand(directory, [ 'run', '--record' ]), 1);
    await writeLastFailedCase(directory, true);
    scope.assert.equal(await executeLastFailedCommand(directory, [ 'run', '--last-failed' ]), 0);
    scope.assert.equal(await executeLastFailedCommand(directory, [ 'run', '--last-failed' ]), 0);
    await assertLastFailedRecords(scope, directory);
}

export const testNode = suite(
    'run recording across execution boundaries',
    ([ 'in-process', 'supervised-process', 'worker-pool' ] as const).map(function executionMode(mode) {
        return test(mode, async function (scope: TestScope) {
            await assertRecordedExecution(scope, mode);
            await assertLastFailedExecution(scope, mode);
            return scope.assert.collect();
        });
    })
);
await runIfMain(import.meta, testNode);
