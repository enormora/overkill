import { runIfMain } from '#test-runner';
import { suite, test } from '../packages/test/test.entry-point.ts';
import type {
    RunArtifact,
    RunResult,
    ExecuteDebugSelection,
    TestDebugArtifact,
    TestScope
} from '../packages/engine/engine.entry-point.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import { parseRunArtifacts } from '../run/run-artifact-schema.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
async function executeProbe(
    debug: ExecuteDebugSelection,
    body: (scope: TestScope) => void,
    retries: number
): Promise<RunResult> {
    const engine = createTestEngine();
    const plan = engine.createTestPlan(engine.createRoot({
        annotations: {},
        controls: {},
        title: 'root',
        children: [
            engine.createTestCase({
                ...metadata,
                title: 'probe',
                body(scope: TestScope) {
                    body(scope);
                    return scope.assert.collect();
                }
            })
        ]
    }));
    return await engine.execute(plan, {
        debug,
        execution: { mode: 'serial-in-process' },
        retryPolicy: retries > 1 ? { maxAttempts: retries } : null,
        reporters: [],
        runFacts: {},
        startedAt: '1970-01-01T00:00:00.000Z'
    });
}
function debugArtifacts(artifacts: readonly RunArtifact[]): readonly TestDebugArtifact[] {
    return artifacts.filter(function debugArtifact(artifact): artifact is TestDebugArtifact {
        return artifact.payload.kind === 'debug';
    });
}
function assertDebugRoundTrip(scope: TestScope, artifacts: readonly RunArtifact[]): void {
    const encoded = JSON.stringify(artifacts);
    const decoded: unknown = JSON.parse(encoded);
    scope.assert.deepEqual(parseRunArtifacts(decoded), decoded);
}

export const testNode = suite('debug diagnostics', [
    test({
        title: 'debug off never reads registered providers',
        async body(scope: TestScope) {
            let reads = 0;
            const result = await executeProbe({ mode: 'off' }, function body(inner: TestScope) {
                inner.debug.includeRecording({
                    name: 'http',
                    recorded() {
                        reads += 1;
                        return [];
                    }
                });
                inner.assert.equal(1, 1);
            }, 1);
            scope.assert.equal(reads, 0);
            scope.assert.equal(debugArtifacts(result.artifacts).length, 0);
            scope.assert.equal(result.perTest[0]?.verdict, 'pass');
            return scope.assert.collect();
        }
    }),
    test({
        title: 'debug records passing attempts and JSON-safe provider evidence',
        async body(scope: TestScope) {
            const result = await executeProbe({ mode: 'all' }, function body(inner: TestScope) {
                inner.plan(2);
                inner.debug.includeRecording({
                    name: 'http',
                    recorded() {
                        return [ { kind: 'http.request', at: 5n } ];
                    }
                });
                inner.require.defined(1);
                inner.assert.equal(2, 2);
            }, 1);
            const artifact = debugArtifacts(result.artifacts)[0];
            scope.require.defined(artifact);
            scope.assert.equal(artifact.payload.verdict, 'pass');
            scope.assert.deepEqual(
                artifact.payload.timeline.map(function kind(entry) {
                    return entry.kind;
                }),
                [ 'body-start', 'plan', 'require', 'assert', 'body-end' ]
            );
            scope.require.notNull(artifact.payload.plan);
            scope.assert.deepEqual(artifact.payload.plan, { declared: 2, recorded: 2 });
            scope.assert.equal(artifact.payload.stats.handleCallCount, 1);
            assertDebugRoundTrip(scope, result.artifacts);
            return scope.assert.collect();
        }
    }),
    test({
        title: 'provider failure fails the run and preserves the passing verdict',
        async body(scope: TestScope) {
            const result = await executeProbe({ mode: 'all' }, function body(inner: TestScope) {
                inner.debug.includeRecording({
                    name: 'broken',
                    recorded() {
                        throw new Error('recording failed');
                    }
                });
                inner.assert.equal(1, 1);
            }, 1);
            scope.assert.equal(result.status, 'failed');
            scope.assert.equal(result.perTest[0]?.verdict, 'pass');
            scope.assert.equal(
                result.runnerErrors.some(function artifactError(error) {
                    return error.subtype === 'artifact';
                }),
                true
            );
            scope.assert.equal(debugArtifacts(result.artifacts)[0]?.payload.completeness, 'incomplete');
            return scope.assert.collect();
        }
    }),
    test({
        title: 'selected debug work does not remove ordinary cases',
        async body(scope: TestScope) {
            const result = await executeProbe({ mode: 'selected', work: [] }, function body(inner: TestScope) {
                inner.assert.equal(1, 1);
            }, 1);
            scope.assert.equal(result.perTest.length, 1);
            scope.assert.equal(debugArtifacts(result.artifacts).length, 0);
            return scope.assert.collect();
        }
    }),
    test({
        title: 'each retry keeps its own diagnostics',
        async body(scope: TestScope) {
            const result = await executeProbe({ mode: 'all' }, function body(inner: TestScope) {
                inner.assert.equal(1, 2);
            }, 3);
            scope.assert.deepEqual(
                debugArtifacts(result.artifacts).map(function attempt(artifact) {
                    return artifact.id.attempt.index;
                }),
                [ 0, 1, 2 ]
            );
            return scope.assert.collect();
        }
    })
]);
await runIfMain(import.meta, testNode);
