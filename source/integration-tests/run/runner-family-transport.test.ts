import { runIfMain } from '#test-runner';
import { isDefinedFamilyProfile } from '../../config/types.ts';
import { suite, test } from '../../packages/test/test.entry-point.ts';
import { normalizeConfig, orchestrator, type NormalizedConfig } from '../../packages/run/run.entry-point.ts';
import { defaultRunRequest } from '../../test-support/run-command-factory.ts';
import { family as analysisFamily } from './fixtures/imported-analysis-family.ts';
import { family } from './fixtures/imported-runtime-family.ts';
import { family as stalledFamily } from './fixtures/stalled-family.ts';

const files = { include: [ 'source/integration-tests/run/fixtures/passing.test.ts' ] } as const;
const timeouts = { collectionMilliseconds: 60_000, softMilliseconds: 60_000, hardMilliseconds: 60_000 };

function hostedRuntimeConfig(): NormalizedConfig {
    const config = normalizeConfig({
        profiles: {
            custom: {
                testFamily: family,
                settings: null,
                files,
                timeouts,
                execution: { processModel: 'worker-pool', maxWorkers: 1, scheduling: 'serial' }
            }
        }
    });
    const profile = config.profiles.custom;
    if (profile === undefined || !isDefinedFamilyProfile(profile) || profile.execution.processModel !== 'worker-pool') {
        throw new Error('Missing worker-pool profile.');
    }
    return {
        ...config,
        profiles: {
            custom: {
                ...profile,
                execution: { ...profile.execution, hostProcess: { kind: 'child', nodeArguments: [] } }
            }
        }
    };
}

export const testNode = suite('imported family transport', [
    test('executes imported runtime variants through a child worker host', async function (scope) {
        const result = await orchestrator.run({
            cwd: process.cwd(),
            engine: { kind: 'default' },
            config: hostedRuntimeConfig(),
            request: defaultRunRequest({ profile: 'custom' })
        });
        scope.assert.equal(result.status, 'passed');
        scope.assert.equal(result.summary.passed, 2);
        scope.assert.deepEqual(result.runnerErrors, []);
        return scope.assert.collect();
    }),
    test('terminates preparation blocked before case admission', async function (scope) {
        const config = normalizeConfig({
            profiles: {
                custom: {
                    testFamily: stalledFamily,
                    settings: null,
                    files,
                    execution: { processModel: 'supervised-process', scheduling: 'serial' },
                    timeouts: { ...timeouts, softMilliseconds: 100, hardMilliseconds: 200 }
                }
            }
        });
        const result = await orchestrator.run({
            cwd: process.cwd(),
            engine: { kind: 'default' },
            config,
            request: defaultRunRequest({ profile: 'custom' })
        });
        scope.assert.equal(result.status, 'failed');
        scope.assert.equal(
            result.runnerErrors.some(function hardTimeout(error) {
                return error.message === 'Supervised child exceeded hard timeout.';
            }),
            true
        );
        return scope.assert.collect();
    }),
    ...([ 'supervised-process', 'worker-pool' ] as const).map(function analysisBoundary(processModel) {
        return test(
            `executes imported analysis through ${processModel} without invoking bodies`,
            async function (scope) {
                const execution = processModel === 'worker-pool'
                    ? { processModel, maxWorkers: 1, scheduling: 'serial' as const }
                    : { processModel, scheduling: 'serial' as const };
                const config = normalizeConfig({
                    profiles: {
                        custom: {
                            testFamily: analysisFamily,
                            settings: null,
                            files: { include: [ 'source/integration-tests/run/fixtures/analysis-body.test.ts' ] },
                            execution,
                            timeouts
                        }
                    }
                });
                const result = await orchestrator.run({
                    cwd: process.cwd(),
                    engine: { kind: 'default' },
                    config,
                    request: defaultRunRequest({ profile: 'custom' })
                });
                scope.assert.equal(result.status, 'passed');
                scope.assert.equal(result.summary.passed, 1);
                scope.assert.deepEqual(result.runnerErrors, []);
                return scope.assert.collect();
            }
        );
    }),
    ...([ 'supervised-process', 'worker-pool' ] as const).map(function processBoundary(processModel) {
        return test(`executes imported runtime variants through ${processModel}`, async function (scope) {
            const execution = processModel === 'worker-pool'
                ? {
                    processModel,
                    maxWorkers: 1,
                    scheduling: 'serial' as const,
                    workDistribution: { mode: 'case' as const }
                }
                : { processModel, scheduling: 'serial' as const };
            const config = normalizeConfig({
                profiles: {
                    custom: {
                        testFamily: family,
                        settings: null,
                        files,
                        execution,
                        timeouts
                    }
                }
            });
            const result = await orchestrator.run({
                cwd: process.cwd(),
                engine: { kind: 'default' },
                config,
                request: defaultRunRequest({ profile: 'custom' })
            });
            scope.assert.equal(result.status, 'passed');
            scope.assert.equal(result.summary.passed, 2);
            scope.assert.deepEqual(
                result
                    .perTest
                    .map(function variant(item) {
                        return item.workId.familyVariant?.key;
                    })
                    .toSorted(function variantOrder(left, right) {
                        return (left ?? '').localeCompare(right ?? '');
                    }),
                [ 'first', 'second' ]
            );
            scope.assert.deepEqual(result.runnerErrors, []);
            return scope.assert.collect();
        });
    })
]);

await runIfMain(import.meta, testNode);
