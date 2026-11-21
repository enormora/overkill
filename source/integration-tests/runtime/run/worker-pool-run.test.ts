import { type TestScope, suite, test } from '@overkill-dev/test';

import { defaultHistoryPolicy } from '../../../config/history-policy.ts';
import {
    defineOutputRenderer,
    defineReporter,
    type DefinedOutputRenderer
} from '../../../packages/engine/engine.entry-point.ts';
import type { DefinedReporter } from '../../../engine/reporter.ts';
import type { RunArtifact } from '../../../engine/run-result.ts';
import {
    defaultIntegrationProfile,
    defaultMicrotestProfile,
    defaultRunConfig,
    defaultRunRequest
} from '../../../test-support/run-command-factory.ts';
import type { NormalizedConfig } from '../../../config/types.ts';
import { defaultRunEngine } from '../../../run/default-run-engine.ts';
import { orchestrator } from '../../../run/run-orchestrator.entry-point.ts';
import type { RunCommand } from '../../../run/run-types.ts';

const integrationOutputFixturePath = 'source/integration-tests/runtime/fixtures/integration-output.test.ts';
const hostProcessNodeArgumentsFixturePath =
    'source/integration-tests/runtime/fixtures/host-process-node-arguments.test.ts';
const passingFixturePath = 'source/integration-tests/runtime/fixtures/passing.test.ts';
const workerPoolCrashFixturePath = 'source/integration-tests/runtime/fixtures/worker-pool-crash.test.ts';

type ArtifactRecorder = {
    readonly artifacts: () => readonly RunArtifact[];
    readonly reporter: DefinedReporter;
};

function createOutputRenderer(): DefinedOutputRenderer {
    return defineOutputRenderer(function createEmptyOutputRenderer() {
        return {
            render() {
                return '';
            }
        };
    });
}

function createRunConfig(profileName: string, profile: NormalizedConfig['profiles'][string]): NormalizedConfig {
    return {
        history: defaultHistoryPolicy,
        loader: {
            sourceMaps: false,
            stripMode: 'strip-only'
        },
        outputRenderer: createOutputRenderer(),
        profiles: {
            [profileName]: profile,
            microtest: defaultMicrotestProfile()
        },
        reporters: [],
        runtimeStateDir: '.overkill'
    };
}

function integrationCommand(profile: NormalizedConfig['profiles'][string], path: string): RunCommand {
    return {
        config: createRunConfig('integration', profile),
        cwd: process.cwd(),
        engine: { kind: 'default' },
        request: defaultRunRequest({
            paths: [ path ],
            profile: 'integration'
        })
    };
}

function capturedOutputText(artifact: RunArtifact): string {
    if (artifact.payload.kind !== 'captured-output') {
        throw new Error('Expected captured output artifact.');
    }

    return artifact.payload.text;
}

function compareText(first: string, second: string): number {
    return first.localeCompare(second);
}

function capturedOutputTexts(artifacts: readonly RunArtifact[]): readonly string[] {
    return artifacts.map(capturedOutputText).toSorted(compareText);
}

function createArtifactRecorder(): ArtifactRecorder {
    const eventArtifacts: RunArtifact[] = [];

    return {
        artifacts() {
            return eventArtifacts;
        },
        reporter: defineReporter(function createArtifactReporterRuntime() {
            return {
                dispose: null,
                kind: 'real-time',
                name: 'worker-pool-artifact-recorder',
                onEvent(event) {
                    if (event.kind === 'test-end') {
                        eventArtifacts.push(...event.artifacts);
                    }
                },
                onFinish: null,
                sinks: [ { kind: 'memory' } ]
            };
        })
    };
}

export const testNode = suite('Worker pool execution', [
    test('orchestrator.resolve() uses worker-pool for integration defaults', async function (scope) {
        const resolvedRun = await orchestrator.resolve(integrationCommand(
            defaultIntegrationProfile({
                files: {
                    exclude: [],
                    include: [ passingFixturePath ]
                }
            }),
            passingFixturePath
        ));

        if (resolvedRun.facts.execution.processModel !== 'worker-pool') {
            throw new Error('Expected worker-pool execution facts.');
        }

        scope.assert.equal(resolvedRun.facts.execution.assignmentPolicy, 'case-count-balanced');
        scope.assert.deepEqual(resolvedRun.facts.execution.hostProcess, { kind: 'direct' });
        scope.assert.equal(resolvedRun.facts.execution.workerLifecycle, 'reuse');
        scope.assert.deepEqual(resolvedRun.facts.execution.workDistribution, { mode: 'file' });
        scope.assert.equal(resolvedRun.plan.kind, 'worker-pool');

        return scope.assert.collect();
    }),
    test('orchestrator.resolve() preserves explicit worker-pool lifecycle', async function (scope) {
        const resolvedRun = await orchestrator.resolve(integrationCommand(
            defaultIntegrationProfile({
                execution: {
                    processModel: 'worker-pool',
                    scheduling: 'serial',
                    workerLifecycle: 'fresh-worker-per-unit'
                },
                files: {
                    exclude: [],
                    include: [ passingFixturePath ]
                }
            }),
            passingFixturePath
        ));

        if (resolvedRun.facts.execution.processModel !== 'worker-pool') {
            throw new Error('Expected worker-pool execution facts.');
        }

        scope.assert.equal(resolvedRun.facts.execution.assignmentPolicy, 'case-count-balanced');
        scope.assert.deepEqual(resolvedRun.facts.execution.hostProcess, { kind: 'direct' });
        scope.assert.equal(resolvedRun.facts.execution.workerLifecycle, 'fresh-worker-per-unit');
        scope.assert.deepEqual(resolvedRun.facts.execution.workDistribution, { mode: 'file' });

        return scope.assert.collect();
    }),
    test('hosts worker-pool execution with Node arguments', async function (scope) {
        const result = await orchestrator.run(integrationCommand(
            defaultIntegrationProfile({
                execution: {
                    hostProcess: {
                        kind: 'child',
                        nodeArguments: [ '--expose-gc' ]
                    },
                    processModel: 'worker-pool'
                },
                files: {
                    exclude: [],
                    include: [ hostProcessNodeArgumentsFixturePath ]
                },
                timeouts: {
                    collectionMilliseconds: 15_000
                }
            }),
            hostProcessNodeArgumentsFixturePath
        ));

        scope.assert.equal(result.summary.passed, 1);
        scope.assert.deepEqual(result.runnerErrors, []);

        return scope.assert.collect();
    }),
    test(
        'captures worker-pool integration output as artifacts',
        async function (scope) {
            const artifactRecorder = createArtifactRecorder();
            const result = await orchestrator.run(integrationCommand(
                defaultIntegrationProfile({
                    files: {
                        exclude: [],
                        include: [ integrationOutputFixturePath ]
                    },
                    reporters: [ artifactRecorder.reporter ]
                }),
                integrationOutputFixturePath
            ));
            const caseArtifacts = result.artifacts.filter(function isCaseArtifact(artifact) {
                return artifact.id.scope.kind === 'case';
            });
            const runArtifacts = result.artifacts.filter(function isRunArtifact(artifact) {
                return artifact.id.scope.kind === 'run';
            });

            scope.assert.equal(result.summary.passed, 1);
            scope.assert.equal(result.runnerErrors.length, 0);
            scope.assert.deepEqual(runArtifacts.map(capturedOutputText), [ 'collection stdout\n' ]);
            scope.assert.deepEqual(capturedOutputTexts(caseArtifacts), [
                'case stderr\n',
                'case stdout\n'
            ]);
            scope.assert.deepEqual(capturedOutputTexts(artifactRecorder.artifacts()), [
                'case stderr\n',
                'case stdout\n'
            ]);

            return scope.assert.collect();
        }
    ),
    test(
        'returns an empty worker-pool result when selection matches no cases',
        async function (scope) {
            const result = await orchestrator.run({
                ...integrationCommand(
                    defaultIntegrationProfile({
                        files: {
                            exclude: [],
                            include: [ passingFixturePath ]
                        }
                    }),
                    passingFixturePath
                ),
                request: defaultRunRequest({
                    paths: [ passingFixturePath ],
                    profile: 'integration',
                    selection: {
                        filter: { field: 'title', kind: 'equals', value: 'missing' },
                        kind: 'filter'
                    }
                })
            });

            scope.assert.equal(result.summary.planned, 0);
            scope.assert.deepEqual(result.perTest, []);
            scope.assert.deepEqual(result.runnerErrors, []);

            return scope.assert.collect();
        }
    ),
    test(
        'rejects instance engines for worker-pool execution',
        async function (scope) {
            await scope.assert.rejects(async function runWithInstanceEngine() {
                await orchestrator.run({
                    config: defaultRunConfig({
                        profiles: {
                            integration: defaultIntegrationProfile({
                                files: {
                                    exclude: [],
                                    include: [ passingFixturePath ]
                                }
                            }),
                            microtest: defaultMicrotestProfile()
                        }
                    }),
                    cwd: process.cwd(),
                    engine: { engine: defaultRunEngine, kind: 'instance' },
                    request: defaultRunRequest({
                        paths: [ passingFixturePath ],
                        profile: 'integration'
                    })
                });
            }, {
                message: 'Instance engines are not supported with worker-pool execution. Use a module engine.'
            });

            return scope.assert.collect();
        }
    ),
    test('requeues pending cases after a worker-pool crash', async function (scope: TestScope) {
        const result = await orchestrator.run(integrationCommand(
            defaultIntegrationProfile({
                execution: {
                    processModel: 'worker-pool',
                    scheduling: 'serial'
                },
                files: {
                    exclude: [],
                    include: [ workerPoolCrashFixturePath ]
                },
                timeouts: {
                    hardMilliseconds: 200,
                    softMilliseconds: 100
                }
            }),
            workerPoolCrashFixturePath
        ));
        const crash = result.runnerErrors.find(function isCrash(error) {
            return error.subtype === 'crash' && error.attributedTo?.title === 'exits worker';
        });

        scope.assert.equal(result.summary.passed, 2);
        scope.assert.equal(result.summary.crashed, 1);
        scope.require.defined(crash);

        return scope.assert.collect();
    })
]);
