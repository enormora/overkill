import { type TestNode, suite, test } from '@overkill-dev/test';

import { executeMutationScript as executeNodeScript } from '../support/stryker-script.ts';
import type * as SerializationModule from '../../../compare/serialization-context.ts';
import { defaultFailureArtifactPolicy, serializeValue } from '../../../packages/engine/engine.entry-point.ts';

import type * as ObservationModule from '../../../engine/execution-observation.ts';
import { currentFailureArtifactPolicy } from '../../../engine/execution-observation.ts';
import { createDefaultWorkId } from '../../../engine/identity.ts';
import {
    createBoundaryFailureArtifact,
    type ActiveBoundaryWork,
    type BoundaryFailureArtifact
} from '../../../engine/run-artifact.ts';

type ExecutionObservation = Readonly<typeof ObservationModule>;
type SerializationContext = Readonly<typeof SerializationModule>;

const work = createDefaultWorkId({ file: 'example.test.ts', suite: [], title: 'owned', params: null });
const attempt = { index: 0 };
const text = 'abcdefgh';
const observationModuleUrl = new URL('../../../engine/execution-observation.ts', import.meta.url);
const copiedObservationUrl = new URL('?artifact-context-copy', observationModuleUrl);
const copiedSerializationUrl = new URL(
    '../../../compare/serialization-context.ts?artifact-context-copy',
    import.meta.url
);

function crashEvidence(activeWork: readonly ActiveBoundaryWork[]): BoundaryFailureArtifact {
    return createBoundaryFailureArtifact(
        {
            kind: 'worker-crash',
            reason: 'worker exited',
            exitCode: null,
            signal: null,
            coreDumpPath: null,
            nativeAddons: null
        },
        {
            source: 'native',
            workerId: null,
            nodeVersion: null,
            timestamp: '1970-01-01T00:00:00.000Z'
        },
        activeWork,
        0
    );
}

export const testNode: TestNode = suite('failure artifact contexts', [
    test('module copies share execution and serialization budgets', async function (scope) {
        const observation = await import(copiedObservationUrl.href) as ExecutionObservation;
        const serialization = await import(copiedSerializationUrl.href) as SerializationContext;
        const policy = {
            ...defaultFailureArtifactPolicy,
            serialization: { ...defaultFailureArtifactPolicy.serialization, stringBytes: 4 }
        };
        const observed = observation.withFailureArtifactContext(policy, function captureSharedPolicy() {
            return { policy: currentFailureArtifactPolicy(), value: serializeValue(text) };
        }, null);
        scope.assert.deepEqual(observed.policy, policy);
        scope.assert.partialDeepEqual(observed.value, { kind: 'string', value: 'abcd' });
        scope.assert.partialDeepEqual(
            serialization.withSerializationBudget(
                { ...policy.serialization, stringBytes: 2 },
                function captureSharedSerialization() {
                    return serializeValue(text);
                }
            ),
            { kind: 'string', value: 'ab' }
        );
        scope.assert.partialDeepEqual(serializeValue(text), { kind: 'string', value: text });
        return scope.assert.collect();
    }),
    test('out-of-execution capture ignores evidence and uses default budgets', async function (scope) {
        const artifact = crashEvidence([ { work, attempt } ]);
        const script = `
                    import assert from 'node:assert/strict';
                    const {
                        recordBoundaryArtifact,boundaryArtifacts,
                        currentProcessUsageSamplingInterval,currentFailureArtifactPolicy
                    } = await import(${JSON.stringify(observationModuleUrl.href)});
                    const {currentSerializationBudget} = await import(${JSON.stringify(copiedSerializationUrl.href)});
                    recordBoundaryArtifact(JSON.parse(process.argv[1]));
                    assert.deepEqual(boundaryArtifacts(),[]);
                    assert.equal(currentProcessUsageSamplingInterval(),null);
                    assert.equal(currentFailureArtifactPolicy().capturedOutputBytes,1048576);
                    assert.equal(currentSerializationBudget().stringBytes,8192);
                    console.log('unowned capture ignored');
                `;
        const output = await executeNodeScript(script, [ JSON.stringify(artifact) ], process.cwd());
        scope.assert.equal(output, 'unowned capture ignored\n');
        return scope.assert.collect();
    })
]);
