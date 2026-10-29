import { runIfMain } from '#test-runner';
import { createDeterministicClock } from '@enormora/clock';
import { normalizeConfig } from '../config/config.ts';
import { trackRunnerErrorDelivery } from '../engine/reporter-error-delivery-tracking.ts';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { defaultRunRequest } from '../test-support/run-command-factory.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { executeRecordedRun, type RunRecordExecutionDependencies } from './recorded-run.ts';
import type { ResolvedRunInput } from './run-input-resolution.ts';
import type { RunRecord } from './run-record-types.ts';

type RunResult = Awaited<ReturnType<typeof executeRecordedRun>>;

type PolicyFixture = {
    readonly input: ResolvedRunInput;
    readonly writes: readonly RunRecord[];
    readonly dependencies: RunRecordExecutionDependencies;
};

function policyFixture(persist: 'always' | 'on-demand', record: boolean): PolicyFixture {
    const config = normalizeConfig({
        profiles: {
            microtest: {
                testFamily: 'microtest',
                runRecords: { persist }
            }
        }
    });
    const profile = config.profiles.microtest;
    if (profile === undefined) {
        throw new Error('Expected microtest profile.');
    }
    const writes: RunRecord[] = [];
    const input: ResolvedRunInput = {
        benchmarkPurpose: 'compare',
        benchmarkHost: null,
        benchmarkCalibration: null,
        benchmarkNormalization: null,
        config,
        profile,
        engine: { kind: 'default' },
        files: [ { file: 'test.ts', fileSet: null, href: 'file:///project/test.ts', path: '/project/test.ts' } ],
        projectRoot: '/project',
        request: defaultRunRequest({ record })
    };
    return {
        writes,
        input,
        dependencies: {
            node: { arch: 'x64', platform: 'linux', version: '26.9.0' },
            wallClock: createDeterministicClock({ initialUnixEpochMicroseconds: 0n }),
            runtimeStateStore: {
                async read() {
                    return null;
                },
                async write(_path: string, content: string) {
                    writes.push(JSON.parse(content) as RunRecord);
                }
            }
        }
    };
}

async function assertPolicy(scope: TestScope, persist: 'always' | 'on-demand', record: boolean): Promise<void> {
    const fixture = policyFixture(persist, record);
    const enabled = persist === 'always' || record;
    const result = await executeRecordedRun(
        '/project',
        fixture.input,
        fixture.dependencies,
        async function execute(session) {
            scope.assert.equal(session !== null, enabled);
            scope.assert.equal(fixture.writes.length, enabled ? 1 : 0);
            return runResultFactory.build({ status: 'passed' });
        }
    );
    scope.assert.equal(result.status, 'passed');
    scope.assert.equal(fixture.writes.length, enabled ? 2 : 0);
    if (enabled) {
        scope.assert.equal(fixture.writes[0]?.status, 'started');
        scope.assert.equal(fixture.writes.at(-1)?.status, 'completed');
    }
}

export const testNode = suite('run record policy', [
    ...([ [ 'on-demand', false ], [ 'on-demand', true ], [ 'always', false ], [ 'always', true ] ] as const)
        .map(function policyCase([ persist, record ]) {
            return test(`${persist}, record ${String(record)}`, async function (scope: TestScope) {
                await assertPolicy(scope, persist, record);
                return scope.assert.collect();
            });
        }),
    test('repeated executions receive separate record identities', async function (scope: TestScope) {
        const fixture = policyFixture('always', false);
        const execute = async function execute(): Promise<RunResult> {
            return runResultFactory.build({ status: 'passed' });
        };
        await executeRecordedRun('/project', fixture.input, fixture.dependencies, execute);
        await executeRecordedRun('/project', fixture.input, fixture.dependencies, execute);
        scope.assert.equal(fixture.writes.length, 4);
        scope.assert.notEqual(fixture.writes[0]?.id, fixture.writes[2]?.id);
        return scope.assert.collect();
    }),
    test('start write failure blocks execution and returns a runner error', async function (scope: TestScope) {
        const fixture = policyFixture('always', false);
        let executions = 0;
        const delivery = await trackRunnerErrorDelivery(async function executeFailedRecording() {
            return await executeRecordedRun('/project', fixture.input, {
                ...fixture.dependencies,
                runtimeStateStore: {
                    ...fixture.dependencies.runtimeStateStore,
                    async write() {
                        throw new Error('Disk unavailable.');
                    }
                }
            }, async function execute() {
                executions += 1;
                return runResultFactory.build({ status: 'passed' });
            });
        });
        const { result } = delivery;
        scope.assert.deepEqual(delivery.undeliveredRunnerErrors, result.runnerErrors);
        scope.assert.equal(executions, 0);
        scope.assert.equal(result.status, 'failed');
        scope.assert.equal(result.runnerErrors[0]?.subtype, 'runtime-state');
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
