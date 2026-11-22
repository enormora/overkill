import {
    type CompositeAssertionReturn,
    type CompositeCheckBuilder,
    defineCompositeAssertion
} from '@overkill-dev/test/assert';

import { suite, test } from '@overkill-dev/test';

import { defaultHistoryPolicy } from '../../../config/history-policy.ts';
import { startFakeIntegrationOutputChild } from '../../../test-support/supervised-output-fixture.ts';
import {
    defineOutputRenderer,
    defineReporter,
    type DefinedReporter,
    type RunArtifact
} from '../../../packages/engine/engine.entry-point.ts';
import {
    isolatedRunStateDirectory,
    defaultIntegrationProfile,
    defaultMicrotestProfile,
    defaultRunRequest
} from '../../../test-support/run-command-factory.ts';
import type { NormalizedConfig, RunCommand, RunOrchestrator } from '../../../packages/run/run.entry-point.ts';
import { defaultRunEngine } from '../../../run/default-run-engine.ts';
import { createNodeRunOrchestrator } from '../../../run/run-orchestrator.ts';

const integrationOutputFixturePath = 'source/integration-tests/runtime/fixtures/integration-output.test.ts';
const integrationCaptureControlsOutputFixturePath =
    'source/integration-tests/runtime/fixtures/integration-capture-controls-output.test.ts';
const microtestProfile = defaultMicrotestProfile({
    timeouts: { collectionMilliseconds: 5000 }
});

type ArtifactRecorder = {
    readonly artifacts: () => readonly RunArtifact[];
    readonly reporter: DefinedReporter;
};

type CapturedProcessOutput = {
    readonly appendStderr: (chunk: Uint8Array) => void;
    readonly appendStdout: (chunk: Uint8Array) => void;
    readonly stderr: () => string;
    readonly stdout: () => string;
};

function createRunConfig(profileName: string, profile: NormalizedConfig['profiles'][string]): NormalizedConfig {
    return {
        history: defaultHistoryPolicy,
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
            [profileName]: profile,
            microtest: microtestProfile
        },
        reporters: [],
        runtimeStateDir: isolatedRunStateDirectory()
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
                name: 'artifact-recorder',
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

function createCapturedOutput(): CapturedProcessOutput {
    let stdout = '';
    let stderr = '';

    return {
        stderr() {
            return stderr;
        },
        stdout() {
            return stdout;
        },
        appendStderr(chunk: Uint8Array) {
            stderr += Buffer.from(chunk).toString('utf8');
        },
        appendStdout(chunk: Uint8Array) {
            stdout += Buffer.from(chunk).toString('utf8');
        }
    };
}

function installNoPolicyRestriction(): () => void {
    return function restoreNoPolicyRestriction(): void {
        return undefined;
    };
}

function createTestOrchestrator(output: CapturedProcessOutput): RunOrchestrator {
    return createNodeRunOrchestrator({
        defaultEngine: defaultRunEngine,
        async discoverRunFilesWithProjectRoot(request) {
            const files = request.paths.map(function discoverFile(file) {
                const filePath = `${request.cwd}/${file}`;

                return {
                    file,
                    fileSet: null,
                    href: `file://${filePath}`,
                    path: filePath
                };
            });
            const [ firstFile ] = files;

            if (firstFile === undefined) {
                throw new Error('Fake supervised child discovery requires a test file.');
            }

            return {
                files: [ firstFile, ...files.slice(1) ],
                projectRoot: request.cwd
            };
        },
        observeIpcListeners: installNoPolicyRestriction,
        observeProcessExit: installNoPolicyRestriction,
        async loadRunEngineModule() {
            throw new Error('Fake supervised child tests do not load engine modules.');
        },
        async loadRunTestModules() {
            throw new Error('Fake supervised child tests do not load test modules.');
        },
        node: {
            arch: 'x64',
            platform: 'linux',
            version: '26.1.1'
        },
        readEnvironment() {
            return {};
        },
        readStorage() {
            return null;
        },
        stderr: {
            write(chunk) {
                output.appendStderr(chunk);
            },
            writeLine(line) {
                output.appendStderr(Buffer.from(`${line}\n`));
            }
        },
        stdout: {
            write(chunk) {
                output.appendStdout(chunk);
            },
            writeLine(line) {
                output.appendStdout(Buffer.from(`${line}\n`));
            }
        },
        startSupervisedChild: startFakeIntegrationOutputChild,
        startWorkerPoolHost() {
            throw new Error('Fake supervised child tests do not start worker-pool hosts.');
        }
    });
}

function integrationOutputRunCommand(
    artifactReporter: DefinedReporter,
    fixturePath: string,
    capture: RunCommand['request']['capture']
): RunCommand {
    const profile = defaultIntegrationProfile({
        execution: { processModel: 'supervised-process' },
        files: {
            exclude: [],
            include: [ fixturePath ]
        },
        reporters: [ artifactReporter ]
    });

    return {
        config: createRunConfig('integration', profile),
        cwd: process.cwd(),
        engine: { kind: 'default' },
        request: defaultRunRequest({
            capture,
            paths: [ fixturePath ],
            profile: 'integration'
        })
    };
}

const integrationCaseArtifactsChecks = function (
    check: CompositeCheckBuilder<'assert'>,
    artifacts: readonly RunArtifact[]
): CompositeAssertionReturn<'assert'> {
    const [ firstLoopCheck, ...remainingLoopChecks ] = artifacts.map(function (artifact) {
        const initialChecks = check.equal(artifact.id.scope.kind, 'case');
        return artifact.id.scope.kind === 'case'
            ? check.group([
                initialChecks,
                check.equal(artifact.id.scope.confidence, 'active-case'),
                check.equal(artifact.id.scope.case.title, 'captures output')
            ])
            : initialChecks;
    });
    if (firstLoopCheck === undefined) {
        throw new Error('Expected at least one recorded check.');
    }
    const initialChecks = check.group([ firstLoopCheck, ...remainingLoopChecks ]);
    return initialChecks;
};

const assertIntegrationOutputArtifacts = defineCompositeAssertion({
    name: 'integration output artifacts',
    assert(check, result: Awaited<ReturnType<RunOrchestrator['run']>>, eventArtifacts: readonly RunArtifact[]) {
        const caseArtifacts = result.artifacts.filter(function isCaseArtifact(artifact) {
            return artifact.id.scope.kind === 'case';
        });
        const runArtifacts = result.artifacts.filter(function isRunArtifact(artifact) {
            return artifact.id.scope.kind === 'run';
        });
        return check.group([
            check.equal(result.summary.passed, 1),
            check.equal(result.runnerErrors.length, 0),
            check.deepEqual(runArtifacts.map(capturedOutputText), [ 'collection stdout\n' ]),
            check.deepEqual(capturedOutputTexts(caseArtifacts), [
                'case stderr\n',
                'case stdout\n'
            ]),
            check.deepEqual(capturedOutputTexts(eventArtifacts), [
                'case stderr\n',
                'case stdout\n'
            ]),
            integrationCaseArtifactsChecks(check.annotated('integration case artifacts'), caseArtifacts)
        ]);
    }
});

const assertLiveIntegrationOutput = defineCompositeAssertion({
    name: 'live integration output',
    async assert(check, artifactReporter: ArtifactRecorder, output: CapturedProcessOutput) {
        const result = await createTestOrchestrator(output).run(
            integrationOutputRunCommand(artifactReporter.reporter, integrationOutputFixturePath, 'live')
        );
        return check.group([
            check.equal(result.summary.passed, 1),
            check.equal(result.runnerErrors.length, 0),
            check.deepEqual(result.artifacts, []),
            check.deepEqual(artifactReporter.artifacts(), []),
            check.equal(output.stdout(), 'collection stdout\ncase stdout\n'),
            check.equal(output.stderr(), 'case stderr\n')
        ]);
    }
});

const assertCaptureControlsOutput = defineCompositeAssertion({
    name: 'capture controls output',
    async assert(check, artifactReporter: ArtifactRecorder, output: CapturedProcessOutput) {
        const result = await createTestOrchestrator(output).run(
            integrationOutputRunCommand(
                artifactReporter.reporter,
                integrationCaptureControlsOutputFixturePath,
                'buffered'
            )
        );
        return check.group([
            check.equal(result.summary.passed, 1),
            check.equal(result.runnerErrors.length, 0),
            check.deepEqual(result.artifacts.map(capturedOutputText), [ 'collection stdout\n' ]),
            check.deepEqual(artifactReporter.artifacts(), []),
            check.equal(output.stdout(), 'case stdout\n'),
            check.equal(output.stderr(), 'case stderr\n')
        ]);
    }
});

export const testNode = suite('Supervised run artifacts', [
    test(
        'captures unrestricted integration child output as artifacts',
        async function (scope) {
            const artifactRecorder = createArtifactRecorder();
            const output = createCapturedOutput();
            const result = await createTestOrchestrator(output).run(
                integrationOutputRunCommand(
                    artifactRecorder.reporter,
                    integrationOutputFixturePath,
                    'buffered'
                )
            );

            scope.assert(assertIntegrationOutputArtifacts, result, artifactRecorder.artifacts());

            return scope.assert.collect();
        }
    ),
    test('writes unrestricted integration child output live', async function (scope) {
        const artifactRecorder = createArtifactRecorder();
        const output = createCapturedOutput();

        await scope.assert(assertLiveIntegrationOutput, artifactRecorder, output);

        return scope.assert.collect();
    }),
    test('honors integration case capture controls', async function (scope) {
        const artifactRecorder = createArtifactRecorder();
        const output = createCapturedOutput();

        await scope.assert(assertCaptureControlsOutput, artifactRecorder, output);

        return scope.assert.collect();
    })
]);
