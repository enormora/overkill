import { fork, type ChildProcess } from 'node:child_process';
import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import { isReporter, type Reporter } from '../engine/reporter.ts';
import { createDeterministicRunOrchestrator } from '../test-support/create-deterministic-run-orchestrator.ts';
import {
    defaultMicrotestProfile,
    defaultRunRequest
} from '../test-support/run-command-factory.ts';
import type { RunnerError } from '../engine/run-result.ts';
import { supervisedChildProcessEntryPointArgument } from './supervised-child-process.ts';
import { orchestrator } from './run-orchestrator.entry-point.ts';
import type { RunCommand, RunConfig, RunMicrotestProfileConfig, RunRequest } from './run-types.ts';

const delayedPassFixturePath = 'source/integration-tests/run/fixtures/delayed-pass.test.ts';
const endlessLoopFixturePath = 'source/integration-tests/run/fixtures/endless-loop.test.ts';
const envPolicyFixturePath = 'source/integration-tests/run/fixtures/env-policy.test.ts';
const passingFixturePath = 'source/integration-tests/run/fixtures/passing.test.ts';
const childEntryPointExtension = import.meta.url.endsWith('.ts') ? 'ts' : 'js';
const childEntryPoint = new URL(`./supervised-child-process.${childEntryPointExtension}`, import.meta.url);
const failureExitCode = 1;
const generousResourceBudget = Number.MAX_SAFE_INTEGER;
const hardTimeoutMilliseconds = 50;
const resourceGrowthBudgetBytesPerSecond = 1;
const samplingIntervalMilliseconds = 1;
const softTimeoutMilliseconds = 10;

const microtestProfile = defaultMicrotestProfile();
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
    }
});

const failingEventReporter: Reporter = {
    dispose: null,
    kind: 'real-time',
    name: 'failing-event-reporter',
    onEvent() {
        throw new Error('Reporter event failed.');
    },
    onFinish: null,
    sinks: [ { kind: 'memory' } ]
};

function createConsoleReporter(): Reporter {
    const reporter = createOverkillLineReporter();

    if (!isReporter(reporter)) {
        throw new TypeError('Expected package line reporter.');
    }

    return reporter;
}

function createRunConfig(profile: RunMicrotestProfileConfig): RunConfig {
    return {
        loader: {
            sourceMaps: false,
            stripMode: 'strip-only'
        },
        outputRenderer: {
            render() {
                return '';
            }
        },
        profiles: {
            microtest: profile
        },
        reporters: [],
        runtimeStateDir: '.overkill'
    };
}

function createRunConfigWithReporters(
    profile: RunMicrotestProfileConfig,
    reporters: readonly Reporter[]
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

function collectChildMessages(child: ChildProcess): readonly unknown[] {
    const messages: unknown[] = [];

    child.on('message', function recordMessage(message: unknown) {
        messages.push(message);
    });

    return messages;
}

async function waitForCollectedMessage(child: ChildProcess): Promise<void> {
    await new Promise<void>(function resolveCollected(resolve) {
        child.on('message', function receiveMessage(message: unknown) {
            if (isRecord(message) && message.kind === 'collected') {
                resolve();
            }
        });
    });
}

async function waitForExit(child: ChildProcess): Promise<number | null> {
    return await new Promise(function resolveExit(resolve) {
        child.on('exit', function exited(code) {
            resolve(code);
        });
    });
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

function deleteEnvironmentValue(name: string): void {
    const environment: unknown = Reflect.get(process, 'env');

    if (typeof environment === 'object' && environment !== null) {
        Reflect.deleteProperty(environment, name);
    }
}

function runnerErrorCapability(error: RunnerError): string | null {
    const { cause } = error;

    if (!isRecord(cause) || typeof cause.capability !== 'string') {
        return null;
    }

    return cause.capability;
}

function runnerErrorCapabilityCount(result: Awaited<ReturnType<typeof orchestrator.run>>, capability: string): number {
    return result
        .runnerErrors
        .filter(function hasCapability(error) {
            return runnerErrorCapability(error) === capability;
        })
        .length;
}

export const testSuite = createOverkillSuite({
    name: 'source/run/supervised-run.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'orchestrator.run() reports hard-timeout crashes from the supervised child',
            metadata: {},
            async body(scope: OverkillScope) {
                const runOrchestrator = createDeterministicRunOrchestrator();
                const result = await runOrchestrator.run(createRunCommand(endlessLoopFixturePath, {
                    ...microtestProfile,
                    timeouts: {
                        collectionMilliseconds: 1000,
                        hardMilliseconds: hardTimeoutMilliseconds,
                        softMilliseconds: softTimeoutMilliseconds
                    }
                }));
                const error = result.runnerErrors[0];

                scope.require.defined(error);
                scope.require.defined(error.attributedTo);
                scope.assert.equal(error.subtype, 'crash');
                scope.assert.equal(error.attributedTo.name, 'loops');
                scope.assert.equal(result.summary.crashed, 1);
                scope.assert.equal(result.summary.resourceExhausted, 0);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'orchestrator.run() reports sampled resource exhaustion from the supervised child',
            metadata: {},
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
                scope.assert.equal(error.attributedTo.name, 'delays');
                scope.assert.equal(result.summary.crashed, 0);
                scope.assert.equal(result.summary.resourceExhausted, 1);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'orchestrator.run() reports supervised active resource count exhaustion',
            metadata: {},
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
                scope.assert.equal(error.attributedTo.name, 'delays');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'orchestrator.run() accepts measured supervised execution within budgets',
            metadata: {},
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
            name: 'orchestrator.run() records supervised reporter event failures',
            metadata: {},
            async body(scope: OverkillScope) {
                const result = await orchestrator.run({
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
            name: 'orchestrator.run() consolidates supervised process.env policy errors',
            metadata: {},
            async body(scope: OverkillScope) {
                const result = await orchestrator.run(
                    createRunCommand(envPolicyFixturePath, restrictedMicrotestProfile, {
                        ...createRunRequest(envPolicyFixturePath),
                        capabilityRestrictions: { mode: 'enabled' }
                    })
                );

                deleteEnvironmentValue('OVERKILL_CASE_POLICY_FIXTURE');
                scope.assert.equal(result.summary.runtimePolicy, 1);
                scope.assert.equal(runnerErrorCapabilityCount(result, 'process-env'), 1);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'orchestrator.run() does not report supervised parent orchestration as runtime policy',
            metadata: {},
            async body(scope: OverkillScope) {
                const result = await orchestrator.run({
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
            name: 'orchestrator.run() covers default singleton resource tracking dependencies',
            metadata: {},
            async body(scope: OverkillScope) {
                const result = await orchestrator.run(createRunCommand(delayedPassFixturePath, microtestProfile, {
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
            name: 'supervised child reports assignment mismatches as loader errors',
            metadata: {},
            async body(scope: OverkillScope) {
                const child = fork(childEntryPoint, [ supervisedChildProcessEntryPointArgument ], {
                    cwd: process.cwd(),
                    stdio: [ 'ignore', 'ignore', 'ignore', 'ipc' ]
                });
                const messages = collectChildMessages(child);
                child.send({
                    capabilityRestrictions: { mode: 'disabled' },
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
                });
                await waitForCollectedMessage(child);
                child.send({
                    assignedCases: [
                        {
                            file: delayedPassFixturePath,
                            name: 'missing-case',
                            params: null,
                            suite: []
                        }
                    ],
                    kind: 'assign'
                });
                const exitCode = await waitForExit(child);

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

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
