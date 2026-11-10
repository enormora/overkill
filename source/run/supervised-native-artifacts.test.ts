import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { createDefaultWorkId, workIdentityKey } from '../engine/identity.ts';
import { createBoundaryFailureArtifact, type BoundaryFailure } from '../engine/run-artifact.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import type { RunArtifact, RunResult } from './run-engine-primitives.ts';
import { runningSupervisedRuntime } from './supervised-run-runtime.test.ts';
import { handleChildMessage } from './supervised-run-runtime.ts';

const work = createDefaultWorkId({ file: 'example.test.ts', suite: [], title: 'crashes', params: null });
const sample = {
    activeResourceCount: 2,
    activeResourceTypes: [ 'Timeout' ],
    capturedAtMicroseconds: 1000,
    javaScriptEngineHeapBytes: 100,
    residentSetBytes: 200
};
const failures: readonly BoundaryFailure[] = [
    {
        kind: 'worker-crash',
        reason: 'native crash',
        exitCode: 1,
        signal: null,
        coreDumpPath: null,
        nativeAddons: null
    },
    {
        kind: 'process-exhaustion',
        metric: 'activeResourceCount',
        budget: 1,
        observed: 2,
        enforcement: 'sampled',
        samples: [ sample ],
        processUsageSamplingIntervalMilliseconds: 100
    }
];
const adapter: RunArtifact = {
    id: {
        attempt: null,
        runtimes: [],
        scope: { kind: 'run' },
        sequence: 1,
        subtype: 'adapter',
        workload: null
    },
    payload: { kind: 'adapter', adapter: 'example', facts: {} },
    source: 'native'
};

function nativeCompletion(failure: BoundaryFailure): RunResult {
    const exhausted = failure.kind === 'process-exhaustion';
    const artifact = createBoundaryFailureArtifact(
        failure,
        {
            source: 'native',
            workerId: 'native-worker',
            nodeVersion: '26.13.0',
            timestamp: '1970-01-01T00:00:00.000Z'
        },
        [ { work, attempt: { index: 0 } } ],
        0
    );
    return runResultFactory.build({
        artifacts: [ artifact, adapter ],
        perTest: [ {
            id: work.case,
            workId: work,
            outcome: null,
            verdict: exhausted ? 'process-exhausted' : 'crashed'
        } ],
        summary: {
            crashed: exhausted ? 0 : 1,
            processExhausted: exhausted ? 1 : 0,
            defined: 1,
            discovered: 1,
            planned: 1
        }
    });
}

export const testNode = suite('supervised native completion evidence', [
    ...failures.map(function nativeFailure(failure) {
        return test(
            `retains ${failure.kind} completion evidence after active ownership is cleared`,
            function (scope: TestScope) {
                const runtime = runningSupervisedRuntime();
                runtime.state.addActiveCase(
                    workIdentityKey(work),
                    { capture: null, id: work.case, workId: work },
                    0,
                    { index: 0 }
                );
                const result = nativeCompletion(failure);
                runtime.state.removeActiveCase(workIdentityKey(work));
                handleChildMessage({ kind: 'result', result }, runtime);
                scope.assert.deepEqual(runtime.state.artifacts(), [ result.artifacts[0] ]);
                const completed = runtime.completedResult.read();
                scope.require.notNull(completed);
                scope.assert.deepEqual(completed, result);
                return scope.assert.collect();
            }
        );
    }),
    test('ignores process usage samples delivered after terminal failure', function (scope) {
        const runtime = runningSupervisedRuntime();
        runtime.terminalFailure.write(true);
        handleChildMessage({ kind: 'sample', sample }, runtime);
        scope.assert.equal(runtime.previousSample.read(), null);
        scope.assert.deepEqual(runtime.state.artifacts(), []);
        return scope.assert.collect();
    })
]);

await runIfMain(import.meta, testNode);
