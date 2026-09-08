import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    defineOutputRenderer,
    defineReporter,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import type { DefinedReporter } from '../engine/reporter.ts';
import type { RunArtifact } from '../engine/run-result.ts';
import {
    defaultIntegrationProfile,
    defaultMicrotestProfile,
    defaultRunRequest
} from '../test-support/run-command-factory.ts';
import { orchestrator } from './run-orchestrator.entry-point.ts';
import type { RunCommand, RunConfig } from './run-types.ts';

const integrationOutputFixturePath = 'source/integration-tests/run/fixtures/integration-output.test.ts';
const microtestProfile = defaultMicrotestProfile();

type ArtifactRecorder = {
    readonly artifacts: () => readonly RunArtifact[];
    readonly reporter: DefinedReporter;
};

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

function integrationOutputRunCommand(artifactReporter: DefinedReporter): RunCommand {
    const profile = defaultIntegrationProfile({
        files: {
            exclude: [],
            include: [ integrationOutputFixturePath ]
        },
        reporters: [ artifactReporter ]
    });

    return {
        config: createRunConfig('integration', profile),
        cwd: process.cwd(),
        engine: { kind: 'default' },
        request: defaultRunRequest({
            paths: [ integrationOutputFixturePath ],
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
    result: Awaited<ReturnType<typeof orchestrator.run>>,
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

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/supervised-run-artifacts.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.run() captures unrestricted integration child output as artifacts',
            metadata: {},
            async body(scope: OverkillScope) {
                const artifactRecorder = createArtifactRecorder();
                const result = await orchestrator.run(
                    integrationOutputRunCommand(artifactRecorder.reporter)
                );

                assertIntegrationOutputArtifacts(scope, result, artifactRecorder.artifacts());

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
