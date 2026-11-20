import { type TestNode, table, suite, test, type TestScope } from '@overkill-dev/test';
import type { EngineCaseBody } from '../../../test-support/create-test-engine.ts';

import {
    createEngine,
    defineReporter,
    defaultFailureArtifactPolicy,
    type FailedCheck,
    type ReporterEvent,
    type RealTimeReporter,
    type RunResult,
    type TestFailure
} from '../../../packages/engine/engine.entry-point.ts';

import {
    defineResource,
    withResourceChecks,
    type AnyResourceDefinition,
    startResources,
    ResourceCheckError,
    type ResourceCheckObserver
} from '../../../packages/resources/resources.entry-point.ts';

import { withResource } from '../../../packages/test/resources.entry-point.ts';
import { createResourceLifecycleRuntimePolicy } from '../../../run/resource-lifecycle.ts';

const check: FailedCheck = {
    kind: 'leaf',
    id: 'resource-invariant',
    source: 'assert',
    sourceLocations: [ { kind: 'unknown' } ],
    actual: { kind: 'boolean', value: false },
    expected: { kind: 'boolean', value: true },
    path: [],
    diff: null,
    summary: 'Observed resource invariant failed'
};
const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
const modes = [ 'pass', 'plan', 'missing', 'require', 'throw', 'cleanup' ] as const;
type Mode = (typeof modes)[number];
const expectedFailures = {
    pass: 'resource-check',
    plan: 'test-contract',
    missing: 'test-contract',
    require: 'assertion',
    throw: 'body-error',
    cleanup: 'cleanup-error'
} as const;
const behavior: Readonly<
    Record<
        Mode,
        (
            scope: Pick<TestScope, 'plan' | 'cleanup'> & { readonly require: Pick<TestScope['require'], 'defined'>; }
        ) => void
    >
> = {
    pass() {
        return undefined;
    },
    plan(scope) {
        scope.plan(2);
    },
    missing() {
        return undefined;
    },
    require(scope: Pick<TestScope, 'plan' | 'cleanup'> & { readonly require: Pick<TestScope['require'], 'defined'>; }) {
        scope.require.defined(null);
    },
    throw() {
        throw new Error('body failed');
    },
    cleanup(scope) {
        scope.cleanup(function failedCleanup() {
            throw new Error('cleanup failed');
        });
    }
};
function resourceObserver(kind: 'attempt' | 'lifetime'): ResourceCheckObserver<AnyResourceDefinition> {
    return function observe(context) {
        return {
            prepare() {
                return undefined;
            },
            finalize({ interval }) {
                if (interval.kind === kind) {
                    context.ledger.record(interval, 'service', { kind: 'fail', check });
                }
                return { kind: 'complete' };
            }
        };
    };
}
function observedResource(): AnyResourceDefinition {
    return withResourceChecks(
        defineResource({
            name: 'owner',
            scope: 'per-case',
            requirements: [],
            acquire() {
                return true;
            },
            dispose: null
        }),
        resourceObserver('attempt')
    );
}
function lifetimeResource(): AnyResourceDefinition {
    return withResourceChecks(
        defineResource({
            name: 'shared-owner',
            scope: 'per-run',
            requirements: [],
            acquire() {
                return true;
            },
            dispose: null,
            serializeHandle(handle) {
                return handle;
            },
            deserializeHandle(handle: boolean) {
                return handle;
            }
        }),
        resourceObserver('lifetime')
    );
}
async function executeObserved(
    mode: Mode,
    report: (event: ReporterEvent) => void,
    resource: AnyResourceDefinition
): Promise<{ readonly result: RunResult; readonly invocations: number; }> {
    const engine = createEngine();
    let invocations = 0;
    const body = withResource(resource, function consumer(scope) {
        invocations += 1;
        behavior[mode](scope);
        if (mode !== 'missing') {
            scope.assert.true(true);
        }
        return scope.assert.collect();
    });
    const plan = engine.createTestPlan(
        engine.createRoot({
            ...metadata,
            title: 'root',
            children: [ engine.createTestCase({ ...metadata, title: 'consumer', body }) ]
        })
    );
    const result = await engine.execute(plan, {
        debug: { mode: 'off' },
        failureArtifacts: defaultFailureArtifactPolicy,
        runFacts: {},
        startedAt: '1970-01-01T00:00:00.000Z',
        execution: { mode: 'serial-in-process' },
        retryPolicy: { maxAttempts: 3 },
        runtimePolicy: createResourceLifecycleRuntimePolicy(plan.cases, null),
        reporters: [ defineReporter(function captureReporter(): RealTimeReporter {
            return {
                kind: 'real-time',
                name: 'capture',
                sinks: [ { kind: 'memory' } ],
                dispose: null,
                onFinish: null,
                onEvent(event) {
                    report(event);
                }
            };
        }) ]
    });
    return { result, invocations };
}
function outcomeFailures(result: RunResult): readonly TestFailure[] {
    const outcome = result.perTest[0]?.outcome;
    return outcome?.kind === 'fail' ? outcome.failures : [];
}
function assertObservedOutcome(scope: TestScope, result: RunResult, mode: Mode): void {
    const failures = outcomeFailures(result);
    scope.assert.equal(result.status, 'failed');
    scope.assert.deepEqual({
        verdict: result.perTest[0]?.attempts[0].verdict,
        attempt: result.perTest[0]?.attempts[0].attempt.index
    }, { verdict: 'fail', attempt: 0 });
    scope.assert.true(
        failures.some(function resourceFailure(failure) {
            return failure.kind === 'resource-check' && failure.failures[0].target === 'service';
        })
    );
    scope.assert.true(
        failures.some(function expectedBodyFailure(failure) {
            return failure.kind === expectedFailures[mode];
        })
    );
    scope.assert.true(result.resourceChecks.every(function complete(snapshot) {
        return snapshot.status.kind === 'complete';
    }));
}
async function executeEnclosing(body: EngineCaseBody): Promise<RunResult> {
    const engine = createEngine();
    const child = engine.createTestCase({ ...metadata, title: 'enclosing', body });
    const plan = engine.createTestPlan(engine.createRoot({ ...metadata, title: 'root', children: [ child ] }));
    return await engine.execute(plan);
}
function assertStandaloneFailure(scope: TestScope, result: PromiseSettledResult<void>): void {
    if (result.status !== 'rejected' || !(result.reason instanceof ResourceCheckError)) {
        throw new Error('Expected a structured resource check error.');
    }
    scope.assert.true(
        result.reason.resourceChecks().some(function retained(snapshot) {
            return snapshot.failures[0]?.check.summary === check.summary;
        })
    );
    scope.assert.true(result.reason.errors.length > 0);
}
export const testNode: TestNode = suite('resource check outcomes', [
    table({
        title: 'retains resource checks alongside body evidence without retry',
        cases: modes,
        caseTitle(mode) {
            return `${mode}`;
        },
        async test(scope) {
            const mode = scope.parameters;

            const events: ReporterEvent[] = [];
            const { result, invocations } = await executeObserved(mode, function retainEvent(event) {
                events.push(event);
            }, observedResource());
            scope.assert.equal(invocations, 1);
            assertObservedOutcome(scope, result, mode);
            scope.assert.true(events.some(function finalized(event) {
                return event.kind === 'resource-check-progress' && event.snapshot.status.kind === 'complete';
            }));
            return scope.assert.collect();
        }
    }),
    test('nested engine findings do not fail an enclosing test', async function (scope) {
        const result = await executeEnclosing(async function enclosing(outerScope) {
            const nested = await executeObserved('pass', function ignoreEvent() {
                return undefined;
            }, observedResource());
            outerScope.assert.equal(nested.result.status, 'failed');
            return outerScope.assert.collect();
        });
        scope.assert.equal(result.status, 'passed');
        scope.assert.equal(result.resourceChecks.length, 0);
        return scope.assert.collect();
    }),
    test('caught standalone findings do not become enclosing engine checks', async function (scope) {
        const result = await executeEnclosing(async function enclosing(outerScope) {
            const session = await startResources({
                resources: { owner: lifetimeResource() },
                signal: outerScope.signal
            });
            const [ closure ] = await Promise.allSettled([ session.disposeOnce({ signal: outerScope.signal }) ]);
            outerScope.assert.equal(closure.status, 'rejected');
            return outerScope.assert.collect();
        });
        scope.assert.equal(result.status, 'passed');
        scope.assert.equal(result.resourceChecks.length, 0);
        return scope.assert.collect();
    }),
    test('lifetime findings fail the run without inventing failed cases', async function (scope) {
        const { result, invocations } = await executeObserved('pass', function ignoreEvent() {
            return undefined;
        }, lifetimeResource());
        scope.assert.equal(result.status, 'failed');
        scope.assert.equal(result.summary.failed, 0);
        scope.assert.equal(result.summary.passed, 1);
        scope.assert.equal(result.perTest[0]?.outcome?.kind, 'pass');
        scope.assert.equal(result.runnerErrors.length, 0);
        scope.assert.equal(invocations, 1);
        scope.assert.true(result.resourceChecks.some(function lifetimeFinding(snapshot) {
            return snapshot.owner.scope === 'per-run' && snapshot.interval.kind === 'lifetime' &&
                snapshot.failures.length > 0;
        }));
        return scope.assert.collect();
    }),
    test('standalone closure exposes findings and owner disposal errors together', async function (scope) {
        const resource = withResourceChecks(
            defineResource({
                name: 'standalone',
                scope: 'per-case',
                requirements: [],
                acquire() {
                    return true;
                },
                dispose() {
                    throw new Error('owner disposal failed');
                }
            }),
            function observe(context) {
                return {
                    prepare() {
                        return undefined;
                    },
                    finalize({ interval }) {
                        context.ledger.record(interval, 'target', { kind: 'fail', check });
                        return { kind: 'complete' };
                    }
                };
            }
        );
        const session = await startResources({ resources: { resource }, signal: scope.signal });
        const [ result ] = await Promise.allSettled([ session.disposeOnce({ signal: scope.signal }) ]);
        assertStandaloneFailure(scope, result);
        scope.assert.equal(session.resourceChecks()[0]?.owner.scope, 'per-case');
        return scope.assert.collect();
    })
]);
