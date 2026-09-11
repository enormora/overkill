import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    defineOutputRenderer,
    defineReporter,
    type DefinedOutputRenderer,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import type { DefinedReporter } from '../engine/reporter.ts';
import type { RunArtifact } from '../engine/run-result.ts';
import {
    defaultIntegrationProfile,
    defaultMicrotestProfile,
    defaultRunConfig,
    defaultRunRequest
} from '../test-support/run-command-factory.ts';
import { defaultRunEngine } from './default-run-engine.ts';
import { orchestrator } from './run-orchestrator.entry-point.ts';
import type { RunCommand, RunConfig } from './run-types.ts';

const integrationOutputFixturePath = 'source/integration-tests/run/fixtures/integration-output.test.ts';
const passingFixturePath = 'source/integration-tests/run/fixtures/passing.test.ts';
const workerPoolCrashFixturePath = 'source/integration-tests/run/fixtures/worker-pool-crash.test.ts';

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

function createRunConfig(profileName: string, profile: RunConfig['profiles'][string]): RunConfig {
    return {
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

function integrationCommand(profile: RunConfig['profiles'][string], path: string): RunCommand {
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

export const testNode = createOverkillSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/worker-pool-run.test.ts',
    children: [
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.resolve() uses worker-pool for integration defaults',
            async body(scope: OverkillScope) {
                const resolvedRun = await orchestrator.resolve(integrationCommand(
                    defaultIntegrationProfile({
                        files: {
                            exclude: [],
                            include: [ passingFixturePath ]
                        }
                    }),
                    passingFixturePath
                ));

                scope.assert.equal(resolvedRun.facts.execution.processModel, 'worker-pool');
                scope.assert.equal(resolvedRun.plan.kind, 'worker-pool');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.run() captures worker-pool integration output as artifacts',
            async body(scope: OverkillScope) {
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
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.run() returns an empty worker-pool result when selection matches no cases',
            async body(scope: OverkillScope) {
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
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.run() rejects instance engines for worker-pool execution',
            async body(scope: OverkillScope) {
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
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.run() requeues pending cases after a worker-pool crash',
            async body(scope: OverkillScope) {
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
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
