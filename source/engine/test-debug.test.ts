import { type TestNode, suite, test, type TestScope } from '@overkill-dev/test';
import { type EngineCaseBody, createTestEngine } from '../test-support/create-test-engine.ts';

import {
    defineReporter,
    type DefinedReporter,
    type RunArtifact,
    type RunResult,
    type ExecuteDebugSelection,
    type TestDebugArtifact
} from '../packages/engine/engine.entry-point.ts';

import { parseRunArtifacts } from '../run/run-artifact-schema.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
async function executeProbe(
    debug: ExecuteDebugSelection,
    body: (...parameters: Parameters<EngineCaseBody>) => void,
    retries: number,
    reporters: readonly DefinedReporter[]
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
                body(scope) {
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
        reporters,
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

const failingDebugReporter = defineReporter(function () {
    return {
        dispose: null,
        kind: 'real-time',
        name: 'debug reporter',
        sinks: [],
        onFinish: null,
        onEvent(event) {
            if (event.kind === 'debug-checkpoint' || event.kind === 'runner-error') {
                throw new Error(`Could not deliver ${event.kind}.`);
            }
        }
    };
});

export const testNode: TestNode = suite('debug diagnostics', [
    test('a busy timeline keeps one checkpoint in flight', async function (scope) {
        const checkpoints: number[] = [];
        const reporter = defineReporter(function () {
            return {
                dispose: null,
                kind: 'real-time',
                name: 'debug checkpoint observer',
                sinks: [],
                onFinish: null,
                onEvent(event) {
                    if (event.kind === 'debug-checkpoint') {
                        checkpoints.push(event.artifact.payload.timeline.length);
                    }
                }
            };
        });
        const result = await executeProbe(
            { mode: 'all' },
            function body(inner) {
                for (let index = 0; index < 80; index += 1) {
                    inner.assert.equal(index, index);
                }
            },
            1,
            [ reporter ]
        );
        scope.assert.deepEqual(checkpoints, [ 1 ]);
        scope.assert.equal(debugArtifacts(result.artifacts)[0]?.payload.stats.assertCount, 80);
        return scope.assert.collect();
    }),
    test('debug off never reads registered providers', async function (scope) {
        let reads = 0;
        const result = await executeProbe(
            { mode: 'off' },
            function body(inner) {
                inner.debug.includeRecording({
                    name: 'http',
                    recorded() {
                        reads += 1;
                        return [];
                    }
                });
                inner.assert.equal(1, 1);
            },
            1,
            []
        );
        scope.assert.equal(reads, 0);
        scope.assert.equal(debugArtifacts(result.artifacts).length, 0);
        scope.assert.equal(result.perTest[0]?.verdict, 'pass');
        return scope.assert.collect();
    }),
    test('debug records passing attempts and JSON-safe provider evidence', async function (scope: TestScope) {
        const result = await executeProbe(
            { mode: 'all' },
            function body(inner) {
                const innerRequire: typeof inner.require = inner.require;

                inner.plan(2);
                inner.debug.includeRecording({
                    name: 'http',
                    recorded() {
                        return [ { kind: 'http.request', at: 5n } ];
                    }
                });
                innerRequire.defined(1);
                inner.assert.equal(2, 2);
            },
            1,
            []
        );
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
    }),
    test('oversized evidence is dropped without losing a body rejection', async function (scope: TestScope) {
        const oversized = 'x'.repeat(11 * 1024 * 1024);
        const result = await executeProbe(
            { mode: 'all' },
            function body(inner) {
                inner.debug.includeRecording({
                    name: oversized,
                    recorded() {
                        throw new Error('Oversized provider must not run.');
                    }
                });
                inner.assert.equal(1, 1, { message: oversized });
                throw new Error('probe failed');
            },
            1,
            []
        );
        const artifact = debugArtifacts(result.artifacts)[0];
        scope.require.defined(artifact);
        scope.assert.equal(result.perTest[0]?.verdict, 'fail');
        scope.assert.deepEqual(result.runnerErrors, []);
        scope.assert.partialDeepEqual(artifact.payload, {
            completeness: 'truncated',
            droppedEntries: 2,
            stats: { assertCount: 1 }
        });
        scope.assert.deepEqual(artifact.payload.recordings, []);
        scope.assert.partialDeepEqual(artifact.payload.timeline.slice(-1), [ {
            kind: 'rejection',
            reason: { kind: 'error', message: 'probe failed' }
        } ]);
        return scope.assert.collect();
    }),
    test('provider and reporter failures preserve the passing case verdict', async function (scope) {
        const result = await executeProbe(
            { mode: 'all' },
            function body(inner) {
                inner.debug.includeRecording({
                    name: 'broken',
                    recorded() {
                        throw new Error('recording failed');
                    }
                });
                inner.assert.equal(1, 1);
            },
            1,
            [ failingDebugReporter ]
        );
        scope.assert.equal(result.status, 'failed');
        scope.assert.equal(result.perTest[0]?.verdict, 'pass');
        scope.assert.equal(
            result.runnerErrors.some(function artifactError(error) {
                return error.subtype === 'artifact';
            }),
            true
        );
        scope.assert.equal(debugArtifacts(result.artifacts)[0]?.payload.completeness, 'incomplete');
        scope.assert.equal(
            result.runnerErrors.some(function reporterError(error) {
                return error.subtype === 'reporter';
            }),
            true
        );
        return scope.assert.collect();
    }),
    test('selected debug work does not remove ordinary cases', async function (scope) {
        const result = await executeProbe(
            { mode: 'selected', work: [] },
            function body(inner) {
                inner.assert.equal(1, 1);
            },
            1,
            []
        );
        scope.assert.equal(result.perTest.length, 1);
        scope.assert.equal(debugArtifacts(result.artifacts).length, 0);
        return scope.assert.collect();
    }),
    test('each retry keeps its own diagnostics', async function (scope) {
        const result = await executeProbe(
            { mode: 'all' },
            function body(inner) {
                inner.assert.equal(1, 2);
            },
            3,
            []
        );
        scope.assert.deepEqual(
            debugArtifacts(result.artifacts).map(function attempt(artifact) {
                return artifact.id.attempt.index;
            }),
            [ 0, 1, 2 ]
        );
        return scope.assert.collect();
    })
]);
