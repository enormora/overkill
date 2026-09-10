import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    defineOutputRenderer,
    defineReporter,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import type { DefinedReporter } from '../engine/reporter.ts';
import { createDeterministicRunOrchestrator } from '../test-support/create-deterministic-run-orchestrator.ts';
import {
    defaultMicrotestProfile,
    defaultRunRequest
} from '../test-support/run-command-factory.ts';
import type { RunnerError } from '../engine/run-result.ts';
import type { RunCommand, RunConfig, RunMicrotestProfileConfig, RunOrchestrator, RunRequest } from './run-types.ts';

const delayedPassFixturePath = 'source/integration-tests/run/fixtures/delayed-pass.test.ts';
const endlessLoopFixturePath = 'source/integration-tests/run/fixtures/endless-loop.test.ts';
const envPolicyFixturePath = 'source/integration-tests/run/fixtures/env-policy.test.ts';
const passingFixturePath = 'source/integration-tests/run/fixtures/passing.test.ts';
const generousResourceBudget = Number.MAX_SAFE_INTEGER;
const hardTimeoutMilliseconds = 50;
const resourceGrowthBudgetBytesPerSecond = 1;
const samplingIntervalMilliseconds = 1;
const softTimeoutMilliseconds = 10;

const microtestProfile = defaultMicrotestProfile({
    timeouts: { collectionMilliseconds: 5000 }
});
const restrictedMicrotestProfile = defaultMicrotestProfile({
    timeouts: { collectionMilliseconds: 5000 }
});
const generousMeasuredProfile = defaultMicrotestProfile({
    resourceUsage: {
        budgets: {
            activeResourceCount: generousResourceBudget,
            javaScriptEngineHeapBytes: generousResourceBudget,
            residentSetBytes: generousResourceBudget,
            residentSetGrowthBytesPerSecond: generousResourceBudget
        },
        measure: true,
        samplingIntervalMilliseconds
    },
    timeouts: { collectionMilliseconds: 5000 }
});

const failingEventReporter = defineReporter(function createFailingEventReporter() {
    return {
        dispose: null,
        kind: 'real-time',
        name: 'failing-event-reporter',
        onEvent() {
            throw new Error('Reporter event failed.');
        },
        onFinish: null,
        sinks: [ { kind: 'memory' } ]
    };
});

function createConsoleReporter(): DefinedReporter {
    return defineReporter(function createTerminalReporter() {
        return {
            dispose: null,
            kind: 'real-time',
            name: 'terminal',
            onEvent() {
                return undefined;
            },
            onFinish: null,
            sinks: [ { kind: 'stdout-raw' } ]
        };
    });
}

function createRunConfig(profile: RunMicrotestProfileConfig): RunConfig {
    return {
        loader: {
            sourceMaps: false,
            stripMode: 'strip-only'
        },
        outputRenderer: defineOutputRenderer(function createEmptyOutputRenderer() {
            return {
                render() {
                    return '';
                }
            };
        }),
        profiles: {
            microtest: profile
        },
        reporters: [],
        runtimeStateDir: '.overkill'
    };
}

function createRunConfigWithReporters(
    profile: RunMicrotestProfileConfig,
    reporters: readonly DefinedReporter[]
): RunConfig {
    return {
        ...createRunConfig(profile),
        reporters
    };
}

function createRunRequest(path: string): RunRequest {
    return defaultRunRequest({
        capabilityRestrictions: { mode: 'disabled' },
        paths: [ path ],
        profile: 'microtest'
    });
}

function createRunCommand(
    path: string,
    profile: RunMicrotestProfileConfig,
    request: RunRequest = createRunRequest(path)
): RunCommand {
    return {
        config: createRunConfig(profile),
        cwd: process.cwd(),
        engine: { kind: 'default' },
        request
    };
}

function isRecord(value: unknown): value is Readonly<Record<PropertyKey, unknown>> {
    return typeof value === 'object' && value !== null;
}

function runnerErrorCapability(error: RunnerError): string | null {
    const { cause } = error;

    if (!isRecord(cause) || typeof cause.capability !== 'string') {
        return null;
    }

    return cause.capability;
}

function runnerErrorCapabilityCount(result: Awaited<ReturnType<RunOrchestrator['run']>>, capability: string): number {
    return result
        .runnerErrors
        .filter(function hasCapability(error) {
            return runnerErrorCapability(error) === capability;
        })
        .length;
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/supervised-run.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.run() reports hard-timeout crashes from the supervised child',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const runOrchestrator = createDeterministicRunOrchestrator();
                const result = await runOrchestrator.run(createRunCommand(endlessLoopFixturePath, {
                    ...microtestProfile,
                    timeouts: {
                        collectionMilliseconds: 5000,
                        hardMilliseconds: hardTimeoutMilliseconds,
                        softMilliseconds: softTimeoutMilliseconds
                    }
                }));
                const error = result.runnerErrors[0];

                scope.require.defined(error);
                scope.require.defined(error.attributedTo);
                scope.assert.equal(error.subtype, 'crash');
                scope.assert.equal(error.attributedTo.title, 'loops');
                scope.assert.equal(result.summary.crashed, 1);
                scope.assert.equal(result.summary.resourceExhausted, 0);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.run() reports sampled resource exhaustion from the supervised child',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const runOrchestrator = createDeterministicRunOrchestrator();
                const result = await runOrchestrator.run(createRunCommand(delayedPassFixturePath, {
                    ...microtestProfile,
                    resourceUsage: {
                        budgets: {
                            activeResourceCount: null,
                            javaScriptEngineHeapBytes: null,
                            residentSetBytes: null,
                            residentSetGrowthBytesPerSecond: resourceGrowthBudgetBytesPerSecond
                        },
                        measure: true,
                        samplingIntervalMilliseconds
                    }
                }));
                const error = result.runnerErrors[0];

                scope.require.defined(error);
                scope.require.defined(error.attributedTo);
                scope.assert.equal(error.subtype, 'resource-exhaustion');
                scope.assert.equal(error.attributedTo.title, 'delays');
                scope.assert.equal(result.summary.crashed, 0);
                scope.assert.equal(result.summary.resourceExhausted, 1);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.run() reports supervised active resource count exhaustion',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const runOrchestrator = createDeterministicRunOrchestrator();
                const result = await runOrchestrator.run(createRunCommand(delayedPassFixturePath, {
                    ...microtestProfile,
                    resourceUsage: {
                        budgets: {
                            activeResourceCount: 1,
                            javaScriptEngineHeapBytes: null,
                            residentSetBytes: null,
                            residentSetGrowthBytesPerSecond: null
                        },
                        measure: true,
                        samplingIntervalMilliseconds
                    }
                }));
                const error = result.runnerErrors.find(function isResourceExhaustion(runnerError) {
                    return runnerError.subtype === 'resource-exhaustion';
                });

                scope.require.defined(error);
                scope.require.defined(error.attributedTo);
                scope.assert.equal(error.attributedTo.title, 'delays');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.run() accepts measured supervised execution within budgets',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const runOrchestrator = createDeterministicRunOrchestrator();
                const result = await runOrchestrator.run(createRunCommand(
                    delayedPassFixturePath,
                    generousMeasuredProfile
                ));

                scope.assert.equal(result.summary.passed, 1);
                scope.assert.equal(result.summary.resourceExhausted, 0);
                scope.assert.equal(result.runnerErrors.length, 0);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.run() records supervised reporter event failures',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const runOrchestrator = createDeterministicRunOrchestrator();
                const result = await runOrchestrator.run({
                    config: createRunConfigWithReporters(generousMeasuredProfile, [ failingEventReporter ]),
                    cwd: process.cwd(),
                    engine: { kind: 'default' },
                    request: createRunRequest(delayedPassFixturePath)
                });

                const error = result.runnerErrors[0];

                scope.require.defined(error);
                scope.assert.equal(error.subtype, 'reporter');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.run() consolidates supervised process.env policy errors',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const runOrchestrator = createDeterministicRunOrchestrator();
                const result = await runOrchestrator.run(
                    createRunCommand(envPolicyFixturePath, restrictedMicrotestProfile, {
                        ...createRunRequest(envPolicyFixturePath),
                        capabilityRestrictions: { mode: 'enabled' }
                    })
                );

                scope.assert.equal(result.summary.runtimePolicy, 1);
                scope.assert.equal(runnerErrorCapabilityCount(result, 'process-env'), 1);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.run() does not report supervised parent orchestration as runtime policy',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const runOrchestrator = createDeterministicRunOrchestrator();
                const result = await runOrchestrator.run({
                    config: createRunConfigWithReporters(restrictedMicrotestProfile, [ createConsoleReporter() ]),
                    cwd: process.cwd(),
                    engine: { kind: 'default' },
                    request: {
                        ...createRunRequest(passingFixturePath),
                        capabilityRestrictions: { mode: 'enabled' },
                        seed: { value: null }
                    }
                });

                scope.assert.equal(result.summary.passed, 1);
                scope.assert.deepEqual(result.runnerErrors, []);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.run() records supervised resource usage from injected dependencies',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const runOrchestrator = createDeterministicRunOrchestrator();
                const result = await runOrchestrator.run(createRunCommand(delayedPassFixturePath, microtestProfile, {
                    ...createRunRequest(delayedPassFixturePath),
                    measureResourceUsage: true,
                    profile: 'microtest',
                    seed: { value: null }
                }));

                scope.require.defined(result.resourceUsage);
                scope.assert.equal(result.summary.passed, 1);
                scope.assert.equal(result.runnerErrors.length, 0);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
