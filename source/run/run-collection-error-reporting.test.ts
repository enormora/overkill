import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import type { DefinedReporter } from '../engine/reporter.ts';
import { createDeterministicRunOrchestrator } from '../test-support/create-deterministic-run-orchestrator.ts';
import { defineFixedReporter } from '../test-support/reporter-definition.ts';
import {
    defaultMicrotestProfile,
    defaultRunConfig,
    defaultRunRequest
} from '../test-support/run-command-factory.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import {
    createResultFromResolutionError,
    reportCollectionErrorResult
} from './run-collection-error-result.ts';
import { RunCollectionError } from './run-errors.ts';
import type { RunCommand, RunConfig, RunRequest } from './run-types.ts';

type RunCommandParts = {
    readonly config: RunConfig;
    readonly cwd: string;
    readonly engine: RunCommand['engine'];
    readonly request: RunRequest;
};

type ReporterLifecycleRecorder = {
    readonly entries: () => readonly string[];
    readonly reporter: DefinedReporter;
};

const throwsOnImportFixturePath = 'source/integration-tests/run/fixtures/throws-on-import.test.ts';
const emptySuiteFixturePath = 'source/integration-tests/run/fixtures/empty-suite.test.ts';
const defaultRequest = defaultRunRequest();
const supervisedCollectionConfig = defaultRunConfig({
    profiles: {
        microtest: defaultMicrotestProfile({
            timeouts: { collectionMilliseconds: 5000 }
        })
    }
});
const directCollectionError = new RunCollectionError(
    'Direct collection failed.',
    { cause: new Error('direct cause') },
    'loader'
);

function createRunCommand(overrides: RunCommandParts): RunCommand {
    return {
        config: overrides.config,
        cwd: overrides.cwd,
        engine: overrides.engine,
        request: overrides.request
    };
}

function createReporterLifecycleRecorder(): ReporterLifecycleRecorder {
    const entries: string[] = [];

    return {
        entries() {
            return entries;
        },
        reporter: defineFixedReporter({
            dispose() {
                entries.push('dispose');
            },
            kind: 'real-time',
            name: 'lifecycle-recorder',
            onEvent(event) {
                entries.push(`event:${event.kind}`);
            },
            onFinish(result) {
                entries.push(`finish:${result.runnerErrors[0]?.message ?? 'none'}`);
            },
            sinks: [ { kind: 'memory' } ]
        })
    };
}

function createTerminalFinishReporter(): DefinedReporter {
    return defineFixedReporter({
        dispose: null,
        kind: 'real-time',
        name: 'terminal-finish',
        onEvent() {
            return undefined;
        },
        onFinish() {
            return undefined;
        },
        sinks: [ { kind: 'stderr-raw' } ]
    });
}

function createFakeCollectionResultCommand(): RunCommand {
    return createRunCommand({
        config: defaultRunConfig(),
        cwd: process.cwd(),
        engine: { kind: 'default' },
        request: defaultRequest
    });
}

function createFakeDependencies(
    delivery: Awaited<ReturnType<RunOrchestratorDependencies['reporterDispatcher']['createDelivery']>>
): RunOrchestratorDependencies {
    const reporterDispatcher: RunOrchestratorDependencies['reporterDispatcher'] = {
        async createDelivery() {
            return delivery;
        },
        async trackRunnerErrorDelivery<Result>(work: () => Promise<Result>) {
            return {
                deliveredRunnerErrors: [],
                result: await work(),
                undeliveredRunnerErrors: []
            };
        }
    };

    return {
        reporterDispatcher
    } as unknown as RunOrchestratorDependencies;
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/run-collection-error-reporting.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.run() returns collection failures as runner errors',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const runOrchestrator = createDeterministicRunOrchestrator();
                const importFailureResult = await runOrchestrator.run(createRunCommand({
                    config: supervisedCollectionConfig,
                    cwd: process.cwd(),
                    engine: { kind: 'default' },
                    request: {
                        ...defaultRequest,
                        paths: [ throwsOnImportFixturePath ]
                    }
                }));
                const collectionFailureResult = await runOrchestrator.run(createRunCommand({
                    config: supervisedCollectionConfig,
                    cwd: process.cwd(),
                    engine: { kind: 'default' },
                    request: {
                        ...defaultRequest,
                        paths: [ emptySuiteFixturePath ]
                    }
                }));

                scope.assert.deepEqual(importFailureResult.summary, {
                    crashed: 0,
                    defined: 0,
                    discovered: 0,
                    failed: 0,
                    inconclusive: 0,
                    passed: 0,
                    planned: 0,
                    resourceExhausted: 0,
                    runtimePolicy: 0,
                    skipped: 0
                });
                scope.assert.deepEqual(
                    importFailureResult.runnerErrors.map(function toRunnerError(error) {
                        return {
                            attributedTo: error.attributedTo,
                            message: error.message,
                            subtype: error.subtype
                        };
                    }),
                    [
                        {
                            attributedTo: null,
                            message: `Failed to load test module: ${throwsOnImportFixturePath}`,
                            subtype: 'loader'
                        }
                    ]
                );
                scope.assert.deepEqual(
                    collectionFailureResult.runnerErrors.map(function toMessage(error) {
                        return error.message;
                    }),
                    [ 'Failed to collect tests from run inputs.' ]
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.run() reports collection failures before disposal',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const lifecycle = createReporterLifecycleRecorder();
                const runOrchestrator = createDeterministicRunOrchestrator();
                const result = await runOrchestrator.run(createRunCommand({
                    config: defaultRunConfig({
                        profiles: supervisedCollectionConfig.profiles,
                        reporters: [ lifecycle.reporter ]
                    }),
                    cwd: process.cwd(),
                    engine: { kind: 'default' },
                    request: {
                        ...defaultRequest,
                        paths: [ throwsOnImportFixturePath ]
                    }
                }));

                scope.assert.deepEqual(lifecycle.entries(), [
                    'event:runner-error',
                    'event:run-end',
                    `finish:Failed to load test module: ${throwsOnImportFixturePath}`,
                    'dispose'
                ]);
                scope.assert.equal(
                    result.runnerErrors[0]?.message,
                    `Failed to load test module: ${throwsOnImportFixturePath}`
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.runWithReporterDelivery() tracks terminal collection-error delivery',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const runOrchestrator = createDeterministicRunOrchestrator();
                const result = await runOrchestrator.runWithReporterDelivery(createRunCommand({
                    config: defaultRunConfig({
                        profiles: supervisedCollectionConfig.profiles,
                        reporters: [ createTerminalFinishReporter() ]
                    }),
                    cwd: process.cwd(),
                    engine: { kind: 'default' },
                    request: {
                        ...defaultRequest,
                        paths: [ throwsOnImportFixturePath ]
                    }
                }));

                scope.assert.equal(result.deliveredRunnerErrors[0], result.result.runnerErrors[0]);
                scope.assert.equal(
                    result.deliveredRunnerErrors[0]?.message,
                    `Failed to load test module: ${throwsOnImportFixturePath}`
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'createResultFromResolutionError() rethrows non-collection errors',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const error = new Error('not collection');

                await scope.assert.rejects(async function createResult() {
                    createResultFromResolutionError(error, null);
                }, { message: 'not collection' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'reportCollectionErrorResult() appends reporter delivery errors',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const result = createResultFromResolutionError(directCollectionError, null);
                const reported = await reportCollectionErrorResult(
                    createFakeCollectionResultCommand(),
                    createFakeDependencies({
                        async disposeReporters() {
                            return [
                                {
                                    attributedTo: null,
                                    cause: null,
                                    diagnostics: [],
                                    message: 'dispose failed',
                                    subtype: 'reporter'
                                }
                            ];
                        },
                        async reportEvent(event) {
                            return event.kind === 'runner-error'
                                ? [
                                    {
                                        attributedTo: null,
                                        cause: null,
                                        diagnostics: [],
                                        message: 'runner error notification failed',
                                        subtype: 'reporter'
                                    }
                                ]
                                : [];
                        },
                        async reportResult() {
                            return [
                                {
                                    attributedTo: null,
                                    cause: null,
                                    diagnostics: [],
                                    message: 'final reporter failed',
                                    subtype: 'reporter'
                                }
                            ];
                        }
                    }),
                    result
                );

                scope.assert.deepEqual(
                    reported.runnerErrors.map(function toMessage(error) {
                        return error.message;
                    }),
                    [
                        'Direct collection failed.',
                        'runner error notification failed',
                        'final reporter failed',
                        'dispose failed'
                    ]
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'reportCollectionErrorResult() aggregates cleanup errors after delivery failure',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const result = createResultFromResolutionError(directCollectionError, null);

                await scope.assert.rejects(async function reportCollectionResult() {
                    await reportCollectionErrorResult(
                        createFakeCollectionResultCommand(),
                        createFakeDependencies({
                            async disposeReporters() {
                                return [
                                    {
                                        attributedTo: null,
                                        cause: null,
                                        diagnostics: [],
                                        message: 'cleanup failed',
                                        subtype: 'reporter'
                                    }
                                ];
                            },
                            async reportEvent() {
                                throw new Error('delivery failed');
                            },
                            async reportResult() {
                                return [];
                            }
                        }),
                        result
                    );
                }, { message: 'Execution failed and reporter cleanup failed.' });

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
