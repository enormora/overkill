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

function caseId(title: string): CaseId {
    return {
        file: 'source/example.test.ts',
        params: null,
        suite: [],
        title
    };
}

function addActiveCase(state: SupervisedRunState, testCase: CaseId): void {
    state.addActiveCase(caseIdentityKey(testCase), { id: testCase });
}

function assertConcurrentArtifactScope(
    scope: OverkillScope,
    artifacts: ReturnType<SupervisedRunState['artifacts']>,
    activeCases: readonly CaseId[]
): void {
    for (const artifact of artifacts) {
        scope.assert.equal(artifact.id.scope.kind, 'case');
        if (artifact.id.scope.kind === 'case') {
            scope.assert.equal(artifact.id.scope.confidence, 'concurrent-active');
            scope.assert.deepEqual(artifact.id.scope.activeCases, activeCases);
        }
        scope.assert.equal(artifact.payload.text, 'shared output');
    }
}

function assertCapturedOutputCap(
    scope: OverkillScope,
    artifacts: ReturnType<SupervisedRunState['artifacts']>
): void {
    const overflow = artifacts[1];

    scope.assert.equal(artifacts[0]?.payload.byteLength, capturedOutputLimitBytes);
    scope.require.defined(overflow);
    scope.assert.equal(overflow.payload.byteLength, 0);
    scope.assert.equal(overflow.payload.stream, 'stderr');
    scope.assert.equal(overflow.payload.truncated, true);
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/supervised-run-state.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'createSupervisedRunState() duplicates captured output across concurrent active cases',
            metadata: {},
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
            metadata: {},
            body(scope: OverkillScope) {
                const state = createSupervisedRunState();
                const testCase = caseId('unrelated');

                state.recordCapturedOutput('stderr', Buffer.from('setup output'), 1);

                const artifact = state.artifacts()[0];

                scope.require.defined(artifact);
                scope.assert.equal(artifact.id.scope.kind, 'run');
                scope.assert.equal(artifact.payload.text, 'setup output');
                scope.assert.deepEqual(state.caseArtifacts(testCase), []);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'createSupervisedRunState() applies one captured-output cap per active case',
            metadata: {},
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
