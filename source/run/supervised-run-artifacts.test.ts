import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    defineOutputRenderer,
    defineReporter,
    type DefinedReporter,
    type RunArtifact,
    type TestPlan,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import {
    defaultIntegrationProfile,
    defaultMicrotestProfile,
    defaultRunRequest
} from '../test-support/run-command-factory.ts';
import {
    createFakeSupervisedChildProcess,
    type FakeSupervisedChildRunContext
} from '../test-support/fake-supervised-child-process.ts';
import { collectedRunPlanFromTestPlan } from './collected-run-plan.ts';
import { defaultRunEngine } from './default-run-engine.ts';
import { createNodeRunOrchestrator } from './run-orchestrator.ts';
import type { SupervisedChildProcess } from './supervised-child-process.ts';
import type { RunCommand, RunConfig, RunOrchestrator } from './run-types.ts';

const integrationOutputFixturePath = 'source/integration-tests/run/fixtures/integration-output.test.ts';
const integrationCaptureControlsOutputFixturePath =
    'source/integration-tests/run/fixtures/integration-capture-controls-output.test.ts';
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

function integrationOutputTestPlan(file: string): TestPlan {
    const testNode = defaultRunEngine.createTestCase({
        definitionLocations: [ { kind: 'unknown' as const } ],
        annotations: { tags: [ 'output' ] },
        controls: file === integrationCaptureControlsOutputFixturePath ? { capture: 'live' } : {},
        title: 'captures output',
        body(scope) {
            scope.assert.true(true);

            return scope.assert.collect();
        }
    });

    return defaultRunEngine.createTestPlanFromTestFiles({
        files: [ { file, testNode } ],
        root: {
            annotations: { tags: [ 'output' ] },
            controls: {},
            title: process.cwd()
        }
    });
}

function runFakeIntegrationOutputChild(context: FakeSupervisedChildRunContext): void {
    const [ testCase ] = context.assignment.assignedCases;

    if (testCase === undefined) {
        context.emitExit();

        return;
    }

    context.emitMessage({
        event: {
            attempt: 1,
            case: testCase,
            definitionLocations: [ { kind: 'unknown' } ],
            kind: 'test-start',
            suitePath: []
        },
        kind: 'event'
    });
    context.stdout.emit('case stdout\n');
    context.stderr.emit('case stderr\n');
    context.emitMessage({
        event: {
            attempt: 1,
            artifacts: [],
            case: testCase,
            definitionLocations: [ { kind: 'unknown' } ],
            kind: 'test-end',
            outcome: null,
            suitePath: [],
            verdict: 'pass',
            wallTimeMs: 0
        },
        kind: 'event'
    });
    context.emitExit();
}

async function startFakeIntegrationOutputChild(): Promise<SupervisedChildProcess> {
    return createFakeSupervisedChildProcess({
        collect(input) {
            return {
                collectedPlan: collectedRunPlanFromTestPlan(integrationOutputTestPlan(input.file)),
                runnerErrors: []
            };
        },
        run(context) {
            context.stdout.emit('collection stdout\n');
            runFakeIntegrationOutputChild(context);
        }
    });
}

function createRunConfig(profileName: string, profile: RunConfig['profiles'][string]): RunConfig {
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
            [profileName]: profile,
            microtest: microtestProfile
        },
        reporters: [],
        runtimeStateDir: '.overkill'
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
        installIpcRestriction: installNoPolicyRestriction,
        installProcessExecutionRestriction: installNoPolicyRestriction,
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
        startSupervisedChild: startFakeIntegrationOutputChild
    });
}

function integrationOutputRunCommand(
    artifactReporter: DefinedReporter,
    fixturePath: string,
    capture: RunCommand['request']['capture']
): RunCommand {
    const profile = defaultIntegrationProfile({
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

function assertIntegrationCaseArtifacts(scope: OverkillScope, artifacts: readonly RunArtifact[]): void {
    for (const artifact of artifacts) {
        scope.assert.equal(artifact.id.scope.kind, 'case');
        if (artifact.id.scope.kind === 'case') {
            scope.assert.equal(artifact.id.scope.confidence, 'active-case');
            scope.assert.equal(artifact.id.scope.case.title, 'captures output');
        }
    }
}

function assertIntegrationOutputArtifacts(
    scope: OverkillScope,
    result: Awaited<ReturnType<RunOrchestrator['run']>>,
    eventArtifacts: readonly RunArtifact[]
): void {
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
    scope.assert.deepEqual(capturedOutputTexts(eventArtifacts), [
        'case stderr\n',
        'case stdout\n'
    ]);
    assertIntegrationCaseArtifacts(scope, caseArtifacts);
}

async function assertLiveIntegrationOutput(
    scope: OverkillScope,
    artifactReporter: ArtifactRecorder,
    output: CapturedProcessOutput
): Promise<void> {
    const result = await createTestOrchestrator(output).run(
        integrationOutputRunCommand(artifactReporter.reporter, integrationOutputFixturePath, 'live')
    );

    scope.assert.equal(result.summary.passed, 1);
    scope.assert.equal(result.runnerErrors.length, 0);
    scope.assert.deepEqual(result.artifacts, []);
    scope.assert.deepEqual(artifactReporter.artifacts(), []);
    scope.assert.equal(output.stdout(), 'collection stdout\ncase stdout\n');
    scope.assert.equal(output.stderr(), 'case stderr\n');
}

async function assertCaptureControlsOutput(
    scope: OverkillScope,
    artifactReporter: ArtifactRecorder,
    output: CapturedProcessOutput
): Promise<void> {
    const result = await createTestOrchestrator(output).run(
        integrationOutputRunCommand(
            artifactReporter.reporter,
            integrationCaptureControlsOutputFixturePath,
            'buffered'
        )
    );

    scope.assert.equal(result.summary.passed, 1);
    scope.assert.equal(result.runnerErrors.length, 0);
    scope.assert.deepEqual(result.artifacts.map(capturedOutputText), [ 'collection stdout\n' ]);
    scope.assert.deepEqual(artifactReporter.artifacts(), []);
    scope.assert.equal(output.stdout(), 'case stdout\n');
    scope.assert.equal(output.stderr(), 'case stderr\n');
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/supervised-run-artifacts.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.run() captures unrestricted integration child output as artifacts',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const artifactRecorder = createArtifactRecorder();
                const output = createCapturedOutput();
                const result = await createTestOrchestrator(output).run(
                    integrationOutputRunCommand(
                        artifactRecorder.reporter,
                        integrationOutputFixturePath,
                        'buffered'
                    )
                );

                assertIntegrationOutputArtifacts(scope, result, artifactRecorder.artifacts());

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.run() writes unrestricted integration child output live',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const artifactRecorder = createArtifactRecorder();
                const output = createCapturedOutput();

                await assertLiveIntegrationOutput(scope, artifactRecorder, output);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.run() honors integration case capture controls',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const artifactRecorder = createArtifactRecorder();
                const output = createCapturedOutput();

                await assertCaptureControlsOutput(scope, artifactRecorder, output);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
