import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { table, type TestScope, suite, test } from '@overkill-dev/test';

import { normalizeConfig, orchestrator, type RunCommand } from '../../packages/run/run.entry-point.ts';
import { defaultRunRequest } from '../../test-support/run-command-factory.ts';
import { propertyTrialCounter } from './fixtures/property-console-state.ts';

const fixtureDirectory = 'source/integration-tests/runtime/fixtures/';

function propertyCommand(
    cleanup: TestScope['cleanup'],
    file: string,
    processModel: 'in-process' | 'supervised-process'
): RunCommand {
    const runtimeStateDir = path.join(os.tmpdir(), `overkill-property-policy-${randomUUID()}`);
    cleanup(async function removePropertyState() {
        await rm(runtimeStateDir, { recursive: true, force: true });
    });
    const fixture = `${fixtureDirectory}${file}.test.ts`;
    return {
        config: {
            ...normalizeConfig({
                runtimeStateDir,
                profiles: {
                    laws: {
                        testFamily: 'property',
                        files: { include: [ fixture ] },
                        execution: { processModel, scheduling: 'serial' },
                        timeouts: { collectionMilliseconds: 10_000, softMilliseconds: 5000, hardMilliseconds: 10_000 }
                    }
                }
            }),
            reporters: []
        },
        cwd: process.cwd(),
        engine: { kind: 'default' },
        request: defaultRunRequest({ profile: 'laws', paths: [ fixture ], order: 'plan' })
    };
}

export const testNode = suite('property runner policy', [
    table({
        title: 'executes targeted exploration',
        cases: ([ 'in-process', 'supervised-process' ] as const).flatMap(function processPolicy(processModel) {
            return { processModel };
        }),
        caseTitle({ processModel }) {
            return [ processModel ].map(String).join(', ');
        },
        async test(scope) {
            const { processModel } = scope.parameters;

            const result = await orchestrator.run(propertyCommand(scope.cleanup, 'property-targeted', processModel));
            scope.assert.equal(result.summary.passed, 1);
            return scope.assert.collect();
        }
    }),
    table({
        title: 'transports invalid target contract failures',
        cases: ([ 'in-process', 'supervised-process' ] as const).flatMap(function processPolicy(processModel) {
            return { processModel };
        }),
        caseTitle({ processModel }) {
            return [ processModel ].map(String).join(', ');
        },
        async test(scope) {
            const { processModel } = scope.parameters;

            const result = await orchestrator.run(
                propertyCommand(scope.cleanup, 'property-invalid-target', processModel)
            );
            scope.assert.includes(JSON.stringify(result.perTest), 'property-observation');
            return scope.assert.collect();
        }
    }),
    table({
        title: 'collects policy and executes property trials',
        cases: ([ 'in-process', 'supervised-process' ] as const).flatMap(function processPolicy(processModel) {
            return { processModel };
        }),
        caseTitle({ processModel }) {
            return [ processModel ].map(String).join(', ');
        },
        async test(scope) {
            const { processModel } = scope.parameters;

            const command = propertyCommand(scope.cleanup, 'property-declaration', processModel);
            const resolved = await orchestrator.resolve(command);
            scope.assert.equal(resolved.facts.execution.testFamily, 'property');
            scope.assert.equal(resolved.facts.cases[0]?.propertyPolicy?.newTrials, 200);
            scope.assert.equal(resolved.facts.coveragePolicy, null);
            const result = await orchestrator.run(command);
            scope.assert.equal(result.summary.passed, 1);
            scope.assert.equal(result.summary.failed, 0);
            return scope.assert.collect();
        }
    }),
    table({
        title: 'rejects invalid property settings before execution',
        cases: ([ 'in-process', 'supervised-process' ] as const).flatMap(function processPolicy(processModel) {
            return { processModel };
        }),
        caseTitle({ processModel }) {
            return [ processModel ].map(String).join(', ');
        },
        async test(scope) {
            const { processModel } = scope.parameters;

            await scope.assert.rejects(async function collectInvalidProperty() {
                await orchestrator.resolve(propertyCommand(scope.cleanup, 'property-invalid-settings', processModel));
            }, { message: /Invalid property policy/ });
            return scope.assert.collect();
        }
    }),
    table({
        title: 'applies restricted policy to ordinary cases',
        cases: ([ 'in-process', 'supervised-process' ] as const).flatMap(function processPolicy(processModel) {
            return { processModel };
        }),
        caseTitle({ processModel }) {
            return [ processModel ].map(String).join(', ');
        },
        async test(scope) {
            const { processModel } = scope.parameters;

            const result = await orchestrator.run(propertyCommand(scope.cleanup, 'console-policy', processModel));
            scope.assert.equal(result.summary.runtimePolicy, 1);
            scope.assert.true(result.runnerErrors.some(function consoleViolation(error) {
                return error.subtype === 'runtime-policy';
            }));
            return scope.assert.collect();
        }
    }),
    table({
        title: 'rejects live capture before importing test files',
        cases: ([ 'in-process', 'supervised-process' ] as const).flatMap(function processPolicy(processModel) {
            return { processModel };
        }),
        caseTitle({ processModel }) {
            return [ processModel ].map(String).join(', ');
        },
        async test(scope) {
            const { processModel } = scope.parameters;

            const command = propertyCommand(scope.cleanup, 'throws-on-import', processModel);
            await scope.assert.rejects(async function collectLiveCapture() {
                await orchestrator.resolve({ ...command, request: { ...command.request, capture: 'live' } });
            }, { message: 'Property profiles do not support live capture.' });
            return scope.assert.collect();
        }
    }),
    table({
        title: 'rejects coverage before importing test files',
        cases: ([ 'in-process', 'supervised-process' ] as const).flatMap(function processPolicy(processModel) {
            return { processModel };
        }),
        caseTitle({ processModel }) {
            return [ processModel ].map(String).join(', ');
        },
        async test(scope) {
            const { processModel } = scope.parameters;

            const command = propertyCommand(scope.cleanup, 'throws-on-import', processModel);
            await scope.assert.rejects(async function collectCoverage() {
                await orchestrator.resolve({ ...command, request: { ...command.request, coverage: true } });
            }, { message: 'Coverage can only be requested for microtest profiles.' });
            return scope.assert.collect();
        }
    }),
    test('in-process stops new property inputs after a capability violation', async function (scope) {
        propertyTrialCounter.trials = 0;
        const result = await orchestrator.run(propertyCommand(scope.cleanup, 'property-console-trials', 'in-process'));
        scope.assert.equal(result.summary.runtimePolicy, 1);
        scope.assert.equal(propertyTrialCounter.trials, 1);
        scope.assert.true(result.runnerErrors.some(function capabilityFailure(error) {
            return error.subtype === 'runtime-policy';
        }));
        return scope.assert.collect();
    }),
    test(
        'supervised property profile blocks filesystem effects with permission attribution',
        async function (scope) {
            const result = await orchestrator.run(
                propertyCommand(scope.cleanup, 'fs-write-policy', 'supervised-process')
            );
            scope.assert.equal(result.summary.runtimePolicy, 1);
            scope.assert.true(result.runnerErrors.some(function permissionDenied(error) {
                return error.subtype === 'permission';
            }));
            return scope.assert.collect();
        }
    ),
    test(
        'supervised property profile attributes process budget exhaustion to the active case',
        async function (scope) {
            const command = propertyCommand(scope.cleanup, 'property-heap-pressure', 'supervised-process');
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
        }
    ),
    test(
        'supervised property profile aborts a cooperative body at its soft deadline',
        async function (scope) {
            const command = propertyCommand(scope.cleanup, 'property-wait-for-abort', 'supervised-process');
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
        }
    ),
    test('supervision retains confirmed property evidence when shrinking hangs', async function (scope) {
        const command = propertyCommand(scope.cleanup, 'property-shrink-hang', 'supervised-process');
        const result = await orchestrator.run(command);
        scope.assert.equal(result.summary.crashed, 1);
        const evidence = result.perTest[0]?.property?.invocations[0];
        scope.assert.equal(evidence?.shrinkStatus, 'interrupted');
        scope.assert.includes(JSON.stringify(evidence), 'original failure before shrinking');
        return scope.assert.collect();
    }),
    table({
        title: 'supervision terminates uncooperative properties',
        cases: [ 'property-generator-hang', 'property-codec-hang' ],
        caseTitle(fixture) {
            return fixture;
        },
        async test(scope) {
            const fixture = scope.parameters;

            const command = propertyCommand(scope.cleanup, fixture, 'supervised-process');
            const profile = command.config.profiles.laws;
            if (profile?.testFamily !== 'property') {
                throw new TypeError('Expected property profile.');
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
        }
    }),
    test('supervised property profile terminates a CPU-bound body', async function (scope) {
        const command = propertyCommand(scope.cleanup, 'endless-loop', 'supervised-process');
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
