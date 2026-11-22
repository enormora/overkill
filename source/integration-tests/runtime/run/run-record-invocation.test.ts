import {
    type CompositeCheckBuilder,
    type CompositeAssertionReturn,
    defineCompositeAssertion
} from '@overkill-dev/test/assert';
import { defineMacro, type TestScope, suite, test } from '@overkill-dev/test';

import {
    withMemoryCoverageRecordFixture,
    type CoverageRecordFixture
} from '../../../test-support/coverage-record-fixture.ts';
import { createDeterministicRunTestModuleLoader } from '../../../test-support/deterministic-run-fixtures.ts';
import {
    isolatedRunStateDirectory,
    defaultMicrotestProfile,
    defaultRunConfig
} from '../../../test-support/run-command-factory.ts';
import { createRunCoordinator, type RunCoordinator } from '../../../run/run-coordinator.entry-point.ts';

const passingFile = 'source/integration-tests/runtime/fixtures/passing.test.ts';
const importFailure = 'source/integration-tests/runtime/fixtures/throws-on-import.test.ts';
const config = defaultRunConfig({
    runtimeStateDir: isolatedRunStateDirectory(),
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

const assertRecordingSnapshots = defineCompositeAssertion({
    name: 'recording snapshots',
    assert(check, fixture: CoverageRecordFixture, status: RecordingScenario['status']) {
        const first = fixture.records[0];
        const last = fixture.records.at(-1);
        if (first === undefined) {
            return check.defined(first);
        }
        if (last === undefined) {
            return check.defined(last);
        }
        if (last.result === null) {
            return check.defined(last.result);
        }
        return check.group([
            check.equal(first.status, 'started'),
            check.equal(last.status, 'completed'),
            check.equal(last.result.status, status)
        ]);
    }
});

const assertRecordedRun = defineMacro(function (title: string, scenario: RecordingScenario) {
    return test(title, async function (scope) {
        await withMemoryCoverageRecordFixture(config, scenario.failedWrites, async function execute(fixture) {
            const { command, orchestrator } = recordedInvocation(fixture);
            const result = await orchestrator.run({
                ...command,
                request: { ...command.request, paths: [ scenario.file ] }
            });
            scope.assert.equal(result.status, scenario.status);
            scope.assert.equal(result.summary.passed, scenario.passed);
            scope.assert(assertRecordingSnapshots, fixture, scenario.status);
            if (scenario.failedWrites.length > 0) {
                scope.assert.equal(result.runnerErrors[0]?.subtype, 'runtime-state');
            }
        });

        return scope.assert.collect();
    });
});

type RecordedReplayPlan = NonNullable<CoverageRecordFixture['records'][number]['replayPlan']>;
function replaySelectionChecks(
    check: CompositeCheckBuilder<'assert'>,
    plan: RecordedReplayPlan
): CompositeAssertionReturn<'assert'> {
    return check.deepEqual({
        defined: plan.defined,
        planned: plan.files[0]?.cases.length,
        file: plan.discoveredFiles[0]?.file
    }, { defined: 2, planned: 1, file: passingFile });
}

const assertReplayPlanSnapshot = defineCompositeAssertion({
    name: 'replay plan snapshot',
    assert(check, fixture: CoverageRecordFixture) {
        const started = fixture.records[0];
        const frozen = fixture.records[1];
        if (started === undefined) {
            return check.defined(started);
        }

        if (frozen === undefined) {
            return check.group([ check.defined(frozen) ]);
        }
        const intermediateChecks = check.group([
            check.defined(frozen),
            check.equal(started.replayPlan, null),
            check.deepEqual({ version: frozen.version, status: frozen.status, result: frozen.result }, {
                version: 1,
                status: 'started',
                result: null
            })
        ]);
        if (frozen.replayPlan === null) {
            return check.group([ intermediateChecks, check.defined(frozen.replayPlan) ]);
        }
        return check.group([
            intermediateChecks,
            check.defined(frozen.replayPlan),
            replaySelectionChecks(check, frozen.replayPlan),
            check.deepEqual<unknown, unknown>(fixture.records.at(-1)?.replayPlan, frozen.replayPlan)
        ]);
    }
});

export const testNode = suite('ordinary and reusable recording invocations', [
    test('profile-required recording persists without an explicit request', async function (scope: TestScope) {
        const profile = config.profiles.microtest;
        scope.require.defined(profile);
        const required = {
            ...config,
            profiles: { microtest: { ...profile, runRecords: { persist: 'always' as const } } }
        };
        await withMemoryCoverageRecordFixture(required, [], async function execute(fixture) {
            const { command, orchestrator } = recordedInvocation(fixture);
            const result = await orchestrator.run({ ...command, request: { ...command.request, record: false } });
            scope.assert.equal(result.status, 'passed');
            scope.assert(assertRecordingSnapshots, fixture, 'passed');
        });
        return scope.assert.collect();
    }),
    test('invalid recording requests fail before starting a record', async function (scope) {
        await withMemoryCoverageRecordFixture(config, [], async function execute(fixture) {
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
        await withMemoryCoverageRecordFixture(config, [], async function execute(fixture) {
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
    test('merge recording requires a shard and excludes ordinary recording', async function (scope) {
        await withMemoryCoverageRecordFixture(config, [], async function execute(fixture) {
            const { command, orchestrator } = recordedInvocation(fixture);
            const request = { ...command.request, recordForMerge: true };
            await scope.assert.rejects(async function recordWithoutShards() {
                await orchestrator.run({ ...command, request: { ...request, record: false } });
            }, { message: '--record-for-merge requires more than one shard.' });
            await scope.assert.rejects(async function recordWithBothModes() {
                await orchestrator.run({ ...command, request: { ...request, shard: { index: 1, total: 2 } } });
            }, { message: 'Choose either --record or --record-for-merge.' });
            scope.assert.equal(fixture.records.length, 0);
        });
        return scope.assert.collect();
    }),
    test('persists the replay plan before any result exists', async function (scope) {
        await withMemoryCoverageRecordFixture(config, [], async function execute(fixture) {
            const { command, orchestrator } = recordedInvocation(fixture);
            await orchestrator.run(command);
            scope.assert(assertReplayPlanSnapshot, fixture);
        });
        return scope.assert.collect();
    }),
    assertRecordedRun('ordinary execution records its facts and final result', {
        file: passingFile,
        failedWrites: [],
        status: 'passed',
        passed: 1
    }),
    assertRecordedRun('import failures complete the started record', {
        file: importFailure,
        failedWrites: [],
        status: 'failed',
        passed: 0
    }),
    assertRecordedRun('facts write failures stop execution and complete with a runner error', {
        file: passingFile,
        failedWrites: [ 2 ],
        status: 'failed',
        passed: 0
    }),
    assertRecordedRun('final write failures change a passing execution into a failed command', {
        file: passingFile,
        failedWrites: [ 4 ],
        status: 'failed',
        passed: 1
    }),
    test('empty selections retain complete facts and a failed result', async function (scope) {
        await withMemoryCoverageRecordFixture(config, [], async function execute(fixture) {
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
        async function (scope) {
            await withMemoryCoverageRecordFixture(config, [], async function execute(fixture) {
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
