import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import type { Reporter } from '../engine/reporter.ts';
import { createDeterministicRunOrchestrator } from '../test-support/create-deterministic-run-orchestrator.ts';
import { orchestrator } from './run-orchestrator.ts';
import type { RunCommand, RunConfig, RunRequest, RunResourceUsagePolicy } from './run-types.ts';

const delayedPassFixturePath = 'source/integration-tests/run/fixtures/delayed-pass.test.ts';
const endlessLoopFixturePath = 'source/integration-tests/run/fixtures/endless-loop.test.ts';
const childEntryPoint = fileURLToPath(new URL('./supervised-child.ts', import.meta.url));
const failureExitCode = 1;
const generousResourceBudget = Number.MAX_SAFE_INTEGER;
const hardTimeoutMilliseconds = 50;
const resourceGrowthBudgetBytesPerSecond = 1;
const samplingIntervalMilliseconds = 1;
const timeoutMilliseconds = 10;

const microtestPolicy: RunResourceUsagePolicy = {
    hardTimeoutMilliseconds: 1000,
    measureResourceUsage: false,
    resourceBudgets: {
        activeResourceCount: null,
        javaScriptEngineHeapBytes: null,
        residentSetBytes: null,
        residentSetGrowthBytesPerSecond: null
    },
    resourceUsageSamplingIntervalMilliseconds: 100,
    timeoutMilliseconds: 500
};

const generousMeasuredPolicy: RunResourceUsagePolicy = {
    ...microtestPolicy,
    measureResourceUsage: true,
    resourceBudgets: {
        activeResourceCount: generousResourceBudget,
        javaScriptEngineHeapBytes: generousResourceBudget,
        residentSetBytes: generousResourceBudget,
        residentSetGrowthBytesPerSecond: generousResourceBudget
    },
    resourceUsageSamplingIntervalMilliseconds: samplingIntervalMilliseconds
};

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

function createRunConfig(supervisedPolicy: RunResourceUsagePolicy): RunConfig {
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
            microtest: microtestPolicy,
            microtestSupervised: supervisedPolicy
        },
        reporters: [],
        runtimeStateDir: '.overkill'
    };
}

function createRunConfigWithReporters(
    supervisedPolicy: RunResourceUsagePolicy,
    reporters: readonly Reporter[]
): RunConfig {
    return {
        ...createRunConfig(supervisedPolicy),
        reporters
    };
}

function createRunRequest(path: string): RunRequest {
    return {
        baselineUpdateMode: 'none',
        capture: 'buffered',
        coverage: false,
        debug: { mode: 'off', selectors: [] },
        execution: { mode: 'profile-default' },
        measureResourceUsage: null,
        order: 'plan',
        paths: [ path ],
        profile: 'microtest-supervised',
        resourceBudgetOverrides: null,
        resourceUsageSamplingIntervalMilliseconds: null,
        seed: { value: 42n },
        selection: { kind: 'all' },
        shard: { index: 0, total: 1 },
        verbose: false
    };
}

function createRunCommand(
    path: string,
    supervisedPolicy: RunResourceUsagePolicy,
    request: RunRequest = createRunRequest(path)
): RunCommand {
    return {
        config: createRunConfig(supervisedPolicy),
        cwd: process.cwd(),
        engine: null,
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
                    ...microtestPolicy,
                    hardTimeoutMilliseconds,
                    timeoutMilliseconds
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
                    ...microtestPolicy,
                    measureResourceUsage: true,
                    resourceBudgets: {
                        activeResourceCount: null,
                        javaScriptEngineHeapBytes: null,
                        residentSetBytes: null,
                        residentSetGrowthBytesPerSecond: resourceGrowthBudgetBytesPerSecond
                    },
                    resourceUsageSamplingIntervalMilliseconds: samplingIntervalMilliseconds
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
                    ...microtestPolicy,
                    measureResourceUsage: true,
                    resourceBudgets: {
                        activeResourceCount: 1,
                        javaScriptEngineHeapBytes: null,
                        residentSetBytes: null,
                        residentSetGrowthBytesPerSecond: null
                    },
                    resourceUsageSamplingIntervalMilliseconds: samplingIntervalMilliseconds
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
                    generousMeasuredPolicy
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
                    config: createRunConfigWithReporters(generousMeasuredPolicy, [ failingEventReporter ]),
                    cwd: process.cwd(),
                    engine: null,
                    request: createRunRequest(delayedPassFixturePath)
                });

                const error = result.runnerErrors[0];

                scope.require.defined(error);
                scope.assert.equal(error.subtype, 'reporter');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'orchestrator.run() covers default singleton resource tracking dependencies',
            metadata: {},
            async body(scope: OverkillScope) {
                const result = await orchestrator.run(createRunCommand(delayedPassFixturePath, microtestPolicy, {
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
                const child = fork(childEntryPoint, [], {
                    cwd: process.cwd(),
                    stdio: [ 'ignore', 'ignore', 'ignore', 'ipc' ]
                });
                const messages = collectChildMessages(child);
                child.send({
                    assignedCaseKeys: [ 'missing-case' ],
                    cwd: process.cwd(),
                    hardTimeoutMilliseconds,
                    kind: 'run',
                    paths: [ delayedPassFixturePath ],
                    resourceBudgets: microtestPolicy.resourceBudgets,
                    resourceUsageSamplingIntervalMilliseconds: samplingIntervalMilliseconds,
                    timeoutMilliseconds
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
