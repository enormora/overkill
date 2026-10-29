import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { withCoverageRecordFixture, type CoverageRecordFixture } from '../test-support/coverage-record-fixture.ts';
import { createDeterministicRunTestModuleLoader } from '../test-support/deterministic-run-fixtures.ts';
import { defaultMicrotestProfile, defaultRunConfig } from '../test-support/run-command-factory.ts';
import { createRunCoordinator, type RunCoordinator } from './run.ts';

const passingFile = 'source/integration-tests/run/fixtures/passing.test.ts';
const importFailure = 'source/integration-tests/run/fixtures/throws-on-import.test.ts';
const config = defaultRunConfig({
    profiles: {
        microtest: defaultMicrotestProfile({
            execution: { processModel: 'in-process', scheduling: 'serial' },
            processUsage: { measure: false }
        })
    }
});

type RecordedInvocation = {
    readonly command: CoverageRecordFixture['request']['command'];
    readonly orchestrator: RunCoordinator['orchestrator'];
};

type RecordingScenario = {
    readonly file: string;
    readonly failedWrites: readonly number[];
    readonly status: 'failed' | 'passed';
    readonly passed: number;
};

function recordedInvocation(fixture: CoverageRecordFixture): RecordedInvocation {
    const command = {
        ...fixture.request.command,
        request: {
            ...fixture.request.command.request,
            coverage: false,
            record: true,
            paths: [ passingFile ]
        }
    };
    const { orchestrator } = createRunCoordinator({
        ...fixture.request.dependencies,
        async discoverRunFilesWithProjectRoot(request) {
            const file = request.paths[0];
            if (file === undefined) {
                throw new Error('Recording fixtures require one test file.');
            }
            return {
                projectRoot: request.cwd,
                files: [ {
                    file,
                    fileSet: null,
                    href: `virtual:${file}`,
                    path: `${request.cwd}/${file}`
                } ] as const
            };
        },
        loadRunTestModules: createDeterministicRunTestModuleLoader({
            recordLoadEnvironmentMutation() {
                return undefined;
            }
        })
    });
    return { command, orchestrator };
}

function assertRecordingSnapshots(
    scope: TestScope,
    fixture: CoverageRecordFixture,
    status: RecordingScenario['status']
): void {
    const first = fixture.records[0];
    const last = fixture.records.at(-1);
    scope.require.defined(first);
    scope.require.defined(last);
    scope.require.defined(last.result);
    scope.assert.equal(first.status, 'started');
    scope.assert.equal(last.status, 'completed');
    scope.assert.equal(last.result.status, status);
}

async function assertRecordedRun(scope: TestScope, scenario: RecordingScenario): Promise<void> {
    await withCoverageRecordFixture(config, scenario.failedWrites, async function execute(fixture) {
        const { command, orchestrator } = recordedInvocation(fixture);
        const result = await orchestrator.run({
            ...command,
            request: { ...command.request, paths: [ scenario.file ] }
        });
        scope.assert.equal(result.status, scenario.status);
        scope.assert.equal(result.summary.passed, scenario.passed);
        assertRecordingSnapshots(scope, fixture, scenario.status);
        if (scenario.failedWrites.length > 0) {
            scope.assert.equal(result.runnerErrors[0]?.subtype, 'runtime-state');
        }
    });
}

export const testNode = suite('ordinary and reusable recording invocations', [
    test('profile-required recording persists without an explicit request', async function (scope: TestScope) {
        const profile = config.profiles.microtest;
        scope.require.defined(profile);
        const required = {
            ...config,
            profiles: { microtest: { ...profile, runRecords: { persist: 'always' as const } } }
        };
        await withCoverageRecordFixture(required, [], async function execute(fixture) {
            const { command, orchestrator } = recordedInvocation(fixture);
            const result = await orchestrator.run({ ...command, request: { ...command.request, record: false } });
            scope.assert.equal(result.status, 'passed');
            assertRecordingSnapshots(scope, fixture, 'passed');
        });
        return scope.assert.collect();
    }),
    test('invalid recording requests fail before starting a record', async function (scope: TestScope) {
        await withCoverageRecordFixture(config, [], async function execute(fixture) {
            const { command, orchestrator } = recordedInvocation(fixture);
            const request = { ...command.request };
            Reflect.set(request, 'record', 'invalid');
            await scope.assert.rejects(async function runInvalidRequest() {
                await orchestrator.run({ ...command, request });
            }, { message: 'Record must be a boolean.' });
            scope.assert.equal(fixture.records.length, 0);
        });
        return scope.assert.collect();
    }),
    test('invalid profile persistence fails before starting a record', async function (scope: TestScope) {
        await withCoverageRecordFixture(config, [], async function execute(fixture) {
            const { command, orchestrator } = recordedInvocation(fixture);
            const profile = command.config.profiles.microtest;
            scope.require.defined(profile);
            const runRecords = { ...profile.runRecords };
            Reflect.set(runRecords, 'persist', 'invalid');
            const invalid = { ...command.config, profiles: { microtest: { ...profile, runRecords } } };
            await scope.assert.rejects(async function runInvalidProfile() {
                await orchestrator.run({ ...command, config: invalid });
            }, { message: 'Invalid run record persistence policy.' });
            scope.assert.equal(fixture.records.length, 0);
        });
        return scope.assert.collect();
    }),
    test('ordinary execution records its facts and final result', async function (scope: TestScope) {
        await assertRecordedRun(scope, { file: passingFile, failedWrites: [], status: 'passed', passed: 1 });
        return scope.assert.collect();
    }),
    test('import failures complete the started record', async function (scope: TestScope) {
        await assertRecordedRun(scope, { file: importFailure, failedWrites: [], status: 'failed', passed: 0 });
        return scope.assert.collect();
    }),
    test('facts write failures stop execution and complete with a runner error', async function (scope: TestScope) {
        await assertRecordedRun(scope, { file: passingFile, failedWrites: [ 2 ], status: 'failed', passed: 0 });
        return scope.assert.collect();
    }),
    test('final write failures change a passing execution into a failed command', async function (scope: TestScope) {
        await assertRecordedRun(scope, { file: passingFile, failedWrites: [ 4 ], status: 'failed', passed: 1 });
        return scope.assert.collect();
    }),
    test('empty selections retain complete facts and a failed result', async function (scope: TestScope) {
        await withCoverageRecordFixture(config, [], async function execute(fixture) {
            const { command, orchestrator } = recordedInvocation(fixture);
            const result = await orchestrator.run({
                ...command,
                request: {
                    ...command.request,
                    selection: { kind: 'filter', filter: { field: 'title', kind: 'equals', value: 'missing' } }
                }
            });
            scope.assert.equal(result.planStatus, 'empty-selection');
            scope.assert.equal(fixture.records.at(-1)?.status, 'completed');
            scope.assert.equal(fixture.records.at(-1)?.result?.status, 'failed');
            scope.assert.notEqual(fixture.records.at(-1)?.facts, null);
        });
        return scope.assert.collect();
    }),
    test(
        'collection stays read-only and each reusable invocation completes its own record',
        async function (scope: TestScope) {
            await withCoverageRecordFixture(config, [], async function execute(fixture) {
                const { command, orchestrator } = recordedInvocation(fixture);
                const initialized = await orchestrator.initialize(command);
                const collected = await initialized.collect();
                scope.assert.equal(fixture.records.length, 0);
                const first = await collected.run({ selection: { kind: 'all' } });
                const second = await collected.run({ selection: { kind: 'all' } });
                const completed = fixture.records.filter(function completedRecord(record) {
                    return record.status === 'completed';
                });
                scope.assert.equal(first.status, 'passed');
                scope.assert.equal(second.status, 'passed');
                scope.assert.equal(completed.length, 2);
            });
            return scope.assert.collect();
        }
    )
]);

await runIfMain(import.meta, testNode);
