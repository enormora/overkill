import { runIfMain } from '#test-runner';
import { createLineReporter } from '../../packages/reporter-line/reporter-line.entry-point.ts';
import { normalizeConfig, orchestrator, type RunCommand } from '../../packages/run/run.entry-point.ts';
import { suite, test } from '../../packages/test/test.entry-point.ts';
import { defaultRunRequest } from '../../test-support/run-command-factory.ts';

const fixtureDirectory = 'source/integration-tests/run/fixtures/';

function propertyCommand(file: string, processModel: 'in-process' | 'supervised-process'): RunCommand {
    const path = `${fixtureDirectory}${file}.test.ts`;
    return {
        config: {
            ...normalizeConfig({
                runtimeStateDir: 'target/property-policy-state',
                profiles: {
                    laws: {
                        testFamily: 'property',
                        files: { include: [ path ] },
                        execution: { processModel, scheduling: 'serial' },
                        timeouts: { collectionMilliseconds: 10_000, softMilliseconds: 5000, hardMilliseconds: 10_000 }
                    }
                }
            }),
            reporters: []
        },
        cwd: process.cwd(),
        engine: { kind: 'default' },
        request: defaultRunRequest({ profile: 'laws', paths: [ path ], order: 'plan' })
    };
}

export const testNode = suite('property runner policy', [
    ...([ 'in-process', 'supervised-process' ] as const).flatMap(function processPolicy(processModel) {
        return [
            test(`${processModel} executes targeted exploration`, async function (scope) {
                const result = await orchestrator.run(propertyCommand('property-targeted', processModel));
                scope.assert.equal(result.summary.passed, 1);
                return scope.assert.collect();
            }),
            test(`${processModel} transports invalid target contract failures`, async function (scope) {
                const result = await orchestrator.run(propertyCommand('property-invalid-target', processModel));
                scope.assert.includes(JSON.stringify(result.perTest), 'property-observation');
                return scope.assert.collect();
            }),
            test(`${processModel} collects policy and executes property trials`, async function (scope) {
                const command = propertyCommand('property-declaration', processModel);
                const resolved = await orchestrator.resolve(command);
                scope.assert.equal(resolved.facts.execution.testFamily, 'property');
                scope.assert.equal(resolved.facts.cases[0]?.propertyPolicy?.newTrials, 200);
                scope.assert.equal(resolved.facts.coveragePolicy, null);
                const result = await orchestrator.run(command);
                scope.assert.equal(result.summary.passed, 1);
                scope.assert.equal(result.summary.failed, 0);
                return scope.assert.collect();
            }),
            test(`${processModel} rejects invalid property settings before execution`, async function (scope) {
                await scope.assert.rejects(async function collectInvalidProperty() {
                    await orchestrator.resolve(propertyCommand('property-invalid-settings', processModel));
                }, { message: /Invalid property policy/ });
                return scope.assert.collect();
            }),
            test(`${processModel} applies restricted policy to ordinary cases`, async function (scope) {
                const result = await orchestrator.run(propertyCommand('console-policy', processModel));
                scope.assert.equal(result.summary.runtimePolicy, 1);
                scope.assert.true(result.runnerErrors.some(function consoleViolation(error) {
                    return error.subtype === 'runtime-policy';
                }));
                return scope.assert.collect();
            }),
            test(`${processModel} rejects live capture before importing test files`, async function (scope) {
                const command = propertyCommand('throws-on-import', processModel);
                await scope.assert.rejects(async function collectLiveCapture() {
                    await orchestrator.resolve({ ...command, request: { ...command.request, capture: 'live' } });
                }, { message: 'Property profiles do not support live capture.' });
                return scope.assert.collect();
            }),
            test(`${processModel} rejects coverage before importing test files`, async function (scope) {
                const command = propertyCommand('throws-on-import', processModel);
                await scope.assert.rejects(async function collectCoverage() {
                    await orchestrator.resolve({ ...command, request: { ...command.request, coverage: true } });
                }, { message: 'Coverage can only be requested for microtest profiles.' });
                return scope.assert.collect();
            })
        ];
    }),
    test('in-process stops new property inputs after a capability violation', async function (scope) {
        const fixture = await import('./fixtures/property-console-trials.test.ts');
        fixture.resetPropertyTrialCount();
        const result = await orchestrator.run(propertyCommand('property-console-trials', 'in-process'));
        scope.assert.equal(result.summary.runtimePolicy, 1);
        scope.assert.equal(fixture.propertyTrialCount(), 1);
        scope.assert.true(result.runnerErrors.some(function capabilityFailure(error) {
            return error.subtype === 'runtime-policy';
        }));
        return scope.assert.collect();
    }),
    test('supervised property profile blocks filesystem effects with permission attribution', async function (scope) {
        const result = await orchestrator.run(propertyCommand('fs-write-policy', 'supervised-process'));
        scope.assert.equal(result.summary.runtimePolicy, 1);
        scope.assert.true(result.runnerErrors.some(function permissionDenied(error) {
            return error.subtype === 'permission';
        }));
        return scope.assert.collect();
    }),
    test('supervised property profile attributes process budget exhaustion to the active case', async function (scope) {
        const command = propertyCommand('property-heap-pressure', 'supervised-process');
        const profile = command.config.profiles.laws;
        if (profile?.testFamily !== 'property') {
            throw new TypeError('Expected a property profile.');
        }
        const result = await orchestrator.run({
            ...command,
            config: {
                ...command.config,
                profiles: {
                    laws: {
                        ...profile,
                        timeouts: { ...profile.timeouts, softMilliseconds: 10_000, hardMilliseconds: 15_000 }
                    }
                }
            },
            request: {
                ...command.request,
                measureProcessUsage: true,
                processUsageSamplingIntervalMilliseconds: 1,
                processBudgetOverrides: {
                    activeResourceCount: null,
                    javaScriptEngineHeapBytes: 134_217_728,
                    residentSetBytes: null,
                    residentSetGrowthBytesPerSecond: null
                }
            }
        });
        scope.assert.equal(result.summary.processExhausted, 1, { message: JSON.stringify(result) });
        scope.assert.equal(result.perTest[0]?.id.title, 'grows heap');
        scope.assert.true(result.runnerErrors.some(function processExhaustion(error) {
            return error.subtype === 'process-exhaustion';
        }));
        return scope.assert.collect();
    }),
    test('supervised property profile aborts a cooperative body at its soft deadline', async function (scope) {
        const command = propertyCommand('property-wait-for-abort', 'supervised-process');
        const profile = command.config.profiles.laws;
        if (profile?.testFamily !== 'property') {
            throw new TypeError('Expected a property profile.');
        }
        const result = await orchestrator.run({
            ...command,
            config: {
                ...command.config,
                profiles: {
                    laws: {
                        ...profile,
                        timeouts: { ...profile.timeouts, softMilliseconds: 20, hardMilliseconds: 1000 }
                    }
                }
            }
        });
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.equal(result.summary.crashed, 0);
        scope.assert.includes(JSON.stringify(result.perTest), '"kind":"timeout"');
        return scope.assert.collect();
    }),
    test('supervised property profile terminates a CPU-bound body', async function (scope) {
        const command = propertyCommand('endless-loop', 'supervised-process');
        const profile = command.config.profiles.laws;
        if (profile?.testFamily !== 'property') {
            throw new TypeError('Expected a property profile.');
        }
        const result = await orchestrator.run({
            ...command,
            config: {
                ...command.config,
                profiles: {
                    laws: {
                        ...profile,
                        timeouts: { ...profile.timeouts, softMilliseconds: 100, hardMilliseconds: 300 }
                    }
                }
            }
        });
        scope.assert.equal(result.summary.crashed, 1);
        scope.assert.equal(result.perTest.length, 1);
        return scope.assert.collect();
    })
]);

await runIfMain(import.meta, testNode, { reporters: [ createLineReporter() ] });
