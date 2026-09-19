import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { caseIdentityKey, type CaseId } from '../engine/identity.ts';
import {
    capturedOutputLimitBytes,
    createSupervisedRunState,
    type SupervisedRunState
} from './supervised-run-state.ts';

type RunArtifact = ReturnType<SupervisedRunState['artifacts']>[number];
type CapturedOutputPayload = Extract<RunArtifact['payload'], { readonly kind: 'captured-output'; }>;
type CapturedOutputArtifact = RunArtifact & { readonly payload: CapturedOutputPayload; };

function caseId(title: string): CaseId {
    return {
        file: 'source/example.test.ts',
        params: null,
        suite: [],
        title
    };
}

function addActiveCase(state: SupervisedRunState, testCase: CaseId): void {
    state.addActiveCase(caseIdentityKey(testCase), { capture: null, id: testCase }, 0);
}

function isCapturedOutputArtifact(artifact: RunArtifact): artifact is CapturedOutputArtifact {
    return artifact.payload.kind === 'captured-output';
}

function assertConcurrentArtifactScope(
    scope: OverkillScope,
    artifacts: ReturnType<SupervisedRunState['artifacts']>,
    activeCases: readonly CaseId[]
): void {
    const capturedArtifacts = artifacts.filter(isCapturedOutputArtifact);

    for (const artifact of capturedArtifacts) {
        scope.assert.equal(artifact.payload.kind, 'captured-output');
        scope.assert.equal(artifact.id.scope.kind, 'case');
        if (artifact.id.scope.kind === 'case') {
            scope.assert.equal(artifact.id.scope.confidence, 'concurrent-active');
            scope.assert.deepEqual(artifact.id.scope.activeCases, activeCases);
        }
        scope.assert.equal(artifact.payload.text, 'shared output');
    }
}

function capturedOutputArtifact(
    scope: OverkillScope,
    artifacts: ReturnType<SupervisedRunState['artifacts']>,
    index: number
): CapturedOutputArtifact | null {
    const artifact = artifacts[index];

    scope.require.defined(artifact);
    scope.assert.equal(artifact.payload.kind, 'captured-output');

    return isCapturedOutputArtifact(artifact) ? artifact : null;
}

function assertCapturedOutputCap(
    scope: OverkillScope,
    artifacts: ReturnType<SupervisedRunState['artifacts']>
): void {
    const capped = capturedOutputArtifact(scope, artifacts, 0);
    const overflow = capturedOutputArtifact(scope, artifacts, 1);

    if (capped === null || overflow === null) {
        return;
    }

    scope.assert.equal(capped.payload.byteLength, capturedOutputLimitBytes);
    scope.assert.equal(overflow.payload.byteLength, 0);
    scope.assert.equal(overflow.payload.stream, 'stderr');
    scope.assert.equal(overflow.payload.truncated, true);
}

function assertRunCapturedOutput(
    scope: OverkillScope,
    state: SupervisedRunState,
    testCase: CaseId
): void {
    const artifact = capturedOutputArtifact(scope, state.artifacts(), 0);

    if (artifact === null) {
        return;
    }

    scope.assert.equal(artifact.id.scope.kind, 'run');
    scope.assert.equal(artifact.payload.text, 'setup output');
    scope.assert.deepEqual(state.caseArtifacts(testCase), []);
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/supervised-run-state.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'createSupervisedRunState() duplicates captured output across concurrent active cases',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const state = createSupervisedRunState();
                const firstCase = caseId('first');
                const secondCase = caseId('second');

                addActiveCase(state, firstCase);
                addActiveCase(state, secondCase);
                state.recordCapturedOutput('stdout', Buffer.from('shared output'), 1);

                const artifacts = state.artifacts();

                scope.assert.equal(artifacts.length, 2);
                assertConcurrentArtifactScope(scope, artifacts, [ firstCase, secondCase ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'createSupervisedRunState() records out-of-test output as run artifacts',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const state = createSupervisedRunState();
                const testCase = caseId('unrelated');

                state.recordCapturedOutput('stderr', Buffer.from('setup output'), 1);

                assertRunCapturedOutput(scope, state, testCase);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'createSupervisedRunState() applies one captured-output cap per active case',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const state = createSupervisedRunState();
                const testCase = caseId('capped');

                addActiveCase(state, testCase);
                state.recordCapturedOutput('stdout', Buffer.alloc(capturedOutputLimitBytes, 'a'), 1);
                state.recordCapturedOutput('stderr', Buffer.from('overflow'), 2);

                assertCapturedOutputCap(scope, state.artifacts());

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
