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
import { loadDeterministicRunTestModules } from '../test-support/deterministic-run-fixtures.ts';
import { createVirtualRunDiscovery } from '../test-support/virtual-run-discovery.ts';
import { runSupervisedChild, type SupervisedChildHost } from './supervised-child.ts';
import type { RunCommand, RunConfig, RunMicrotestProfileConfig, RunOrchestrator, RunRequest } from './run-types.ts';

const delayedPassFixturePath = 'source/integration-tests/run/fixtures/delayed-pass.test.ts';
const endlessLoopFixturePath = 'source/integration-tests/run/fixtures/endless-loop.test.ts';
const envPolicyFixturePath = 'source/integration-tests/run/fixtures/env-policy.test.ts';
const passingFixturePath = 'source/integration-tests/run/fixtures/passing.test.ts';
const failureExitCode = 1;
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

function messageEvent(message: unknown): unknown {
    if (!isRecord(message) || message.kind !== 'event') {
        return null;
    }

    return message.event;
}

function runnerErrorMessage(message: unknown): string | null {
    const event = messageEvent(message);

    if (!isRecord(event) || event.kind !== 'runner-error' || !isRecord(event.error)) {
        return null;
    }

    const errorMessage = event.error.message;

    return typeof errorMessage === 'string' ? errorMessage : null;
}

function firstRunnerErrorMessage(messages: readonly unknown[]): string | null {
    for (const message of messages) {
        const messageText = runnerErrorMessage(message);

        if (messageText !== null) {
            return messageText;
        }
    }

    return null;
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

function installNoPolicyRestriction(): () => void {
    return function restoreNoPolicyRestriction(): void {
        return undefined;
    };
}

type SupervisedMessageSink = {
    readonly send: SupervisedChildHost['send'];
};

function createAssignmentMismatchHost(
    messageSink: SupervisedMessageSink,
    setExitCode: (exitCode: number) => void
): SupervisedChildHost {
    const discovery = createVirtualRunDiscovery({
        cwd: process.cwd(),
        directories: [],
        files: [ delayedPassFixturePath ],
        realpaths: {}
    });

    return {
        disconnect() {
            return undefined;
        },
        discoverRunFiles: discovery.discoverRunFiles,
        dropBodyReadPermission() {
            return undefined;
        },
        installIpcRestriction: installNoPolicyRestriction,
        installProcessExecutionRestriction: installNoPolicyRestriction,
        async loadRunEngineModule() {
            throw new Error('Assignment mismatch test does not load engine modules.');
        },
        loadRunTestModules: loadDeterministicRunTestModules,
        readEnvironment() {
            return {};
        },
        readStorage() {
            return null;
        },
        async receiveAssignment() {
            return {
                assignedCases: [
                    {
                        file: delayedPassFixturePath,
                        title: 'missing-case',
                        params: null,
                        suite: []
                    }
                ],
                kind: 'assign'
            };
        },
        async receiveCommand() {
            return {
                capabilityRestrictions: { mode: 'disabled' },
                capture: 'buffered',
                collectionTimeoutMilliseconds: 1000,
                cwd: process.cwd(),
                engine: { kind: 'default' },
                hardTimeoutMilliseconds,
                kind: 'run',
                paths: [ delayedPassFixturePath ],
                resourceBudgets: microtestProfile.resourceUsage.budgets,
                resourceUsageSamplingIntervalMilliseconds: samplingIntervalMilliseconds,
                scheduling: 'concurrent',
                testFamily: 'microtest',
                timeoutMilliseconds: softTimeoutMilliseconds
            };
        },
        send(message) {
            messageSink.send(message);
        },
        setExitCode,
        validatePermissionHost() {
            return undefined;
        }
    };
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
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'supervised child reports assignment mismatches as loader errors',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const messages: unknown[] = [];
                let exitCode: number | null = null;

                await runSupervisedChild(createAssignmentMismatchHost(
                    {
                        send(message) {
                            messages.push(message);
                        }
                    },
                    function recordExitCode(code) {
                        exitCode = code;
                    }
                ));

                scope.assert.equal(exitCode, failureExitCode);
                scope.assert.equal(
                    firstRunnerErrorMessage(messages),
                    'Supervised child test plan did not match assigned case identities.'
                );

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
