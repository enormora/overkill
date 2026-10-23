import assert from 'node:assert/strict';
import { createStoredValue, type StoredValue } from '../stored-value.ts';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { createInterruptedCase, type InterruptedCase } from '../test-support/interrupted-case.ts';
import { createPermissionDenialRuntimePolicy } from '../run/capability-policy.ts';
import { createAssertionRecorder } from './assertion-recorder.ts';
import { createTestScopeLifecycle } from './test-scope-lifecycle.ts';
import type { ConcurrentCase } from './execution-supervision.ts';

type CleanupState = {
    readonly body: PromiseWithResolvers<undefined>;
    readonly cleanup: PromiseWithResolvers<undefined>;
    readonly started: PromiseWithResolvers<undefined>;
    readonly events: readonly string[];
    readonly scopes: readonly TestScope[];
    readonly returned: StoredValue<boolean>;
    readonly recordEvent: (event: string) => void;
    readonly captureScope: (scope: TestScope) => void;
};

type CleanupProbe = CleanupState & { readonly fixture: InterruptedCase; };

function createCleanupProbe(scope: TestScope): CleanupProbe {
    const events: string[] = [];
    const scopes: TestScope[] = [];
    const state: CleanupState = {
        body: Promise.withResolvers<undefined>(),
        cleanup: Promise.withResolvers<undefined>(),
        started: Promise.withResolvers<undefined>(),
        events,
        scopes,
        returned: createStoredValue(false),
        recordEvent(event) {
            events.push(event);
        },
        captureScope(captured) {
            scopes.push(captured);
        }
    };
    const fixture = createInterruptedCase(async function pendingBody(testScope) {
        state.captureScope(testScope);
        testScope.cleanup(function firstCleanup() {
            state.recordEvent('first');
        });
        testScope.cleanup(async function secondCleanup() {
            assert.equal(testScope.signal.aborted, true);
            state.recordEvent('second');
            state.started.resolve(undefined);
            await state.cleanup.promise;
        });
        await state.body.promise;
        return testScope.assert.collect();
    }, null);
    scope.cleanup(fixture.stop);
    return { ...state, fixture };
}

async function trackedExecution(probe: CleanupProbe): Promise<ConcurrentCase> {
    const result = await probe.fixture.run();
    probe.returned.write(true);
    return result;
}

async function finishInterruptedCleanup(probe: CleanupProbe, scope: TestScope): Promise<ConcurrentCase> {
    const running = trackedExecution(probe);
    probe.fixture.clock.advanceByMilliseconds(10);
    await probe.started.promise;
    scope.assert.false(probe.returned.read());
    scope.assert.deepEqual(Array.from(probe.events), [ 'second' ]);
    probe.cleanup.resolve(undefined);
    const result = await running;
    scope.assert.equal(result.result.verdict, 'crashed');
    scope.assert.deepEqual(probe.events, [ 'second', 'first' ]);
    return result;
}

function assertClosedRegistration(probe: CleanupProbe, scope: TestScope): void {
    const captured = probe.scopes[0];
    assert.ok(captured !== undefined);
    scope.assert.throws(function registerLateCleanup() {
        captured.cleanup(function lateCleanup() {
            probe.recordEvent('late');
        });
    }, { message: /cannot be called after test cleanup/ });
    scope.assert.throws(function startLateWork() {
        captured.startInFlight(async function lateOperation() {
            probe.recordEvent('late operation');
        });
    }, { message: /cannot be called after test cleanup/ });
}

async function verifyLateBody(probe: CleanupProbe, result: ConcurrentCase, scope: TestScope): Promise<void> {
    const snapshot = structuredClone(result);
    probe.body.resolve(undefined);
    await scope.yieldToNextTurn();
    scope.assert.deepEqual(probe.events, [ 'second', 'first' ]);
    scope.assert.deepEqual(result, snapshot);
    assertClosedRegistration(probe, scope);
}

function assertCleanupFailures(result: ConcurrentCase, scope: TestScope): void {
    assert.ok(result.result.outcome?.kind === 'fail');
    scope.assert.deepEqual(
        result.result.outcome.failures.map(function cleanupMessage(failure) {
            assert.ok(failure.kind === 'cleanup-error');
            return failure.error.message;
        }),
        [ 'preparation sentinel', 'cleanup sentinel' ]
    );
}

export const testNode = suite('interrupted case cleanup', [
    test('awaits reverse cleanup before returning while the body remains pending', async function (scope) {
        const probe = createCleanupProbe(scope);
        const result = await finishInterruptedCleanup(probe, scope);
        await verifyLateBody(probe, result, scope);
        return scope.assert.collect();
    }),
    ...([ 'unhandledRejection', 'uncaughtException' ] as const).map(function fatalHook(hook) {
        return test(`${hook} closes a pending body's scope before returning`, async function (scope) {
            const state = { gate: Promise.withResolvers<undefined>(), cleanups: createStoredValue(0) };
            const fixture = createInterruptedCase(async function fatalBody(testScope) {
                testScope.cleanup(function recordCleanup() {
                    state.cleanups.write(state.cleanups.read() + 1);
                });
                process.emit(hook, new Error('fatal sentinel'), Promise.resolve());
                await state.gate.promise;
                return testScope.assert.collect();
            }, null);
            scope.cleanup(fixture.stop);
            const result = await fixture.run();
            scope.assert.equal(result.result.verdict, 'crashed');
            scope.assert.equal(state.cleanups.read(), 1);
            state.gate.resolve(undefined);
            await scope.yieldToNextTurn();
            scope.assert.equal(state.cleanups.read(), 1);
            return scope.assert.collect();
        });
    }),
    test('preserves preparation and cleanup failures after interruption', async function (scope) {
        const state = { gate: Promise.withResolvers<undefined>(), policy: createPermissionDenialRuntimePolicy() };
        scope.cleanup(function stopPolicy() {
            state.policy.takeRunErrors();
        });
        const fixture = createInterruptedCase(async function failedCleanup(testScope) {
            testScope.cleanup(function failCleanup() {
                throw new Error('cleanup sentinel');
            });
            await state.gate.promise;
            return testScope.assert.collect();
        }, {
            ...state.policy,
            async prepareAttempt() {
                throw new Error('preparation sentinel');
            }
        });
        scope.cleanup(fixture.stop);
        const running = fixture.run();
        fixture.clock.advanceByMilliseconds(10);
        assertCleanupFailures(await running, scope);
        state.gate.resolve(undefined);
        return scope.assert.collect();
    }),
    test('retains a soft timeout when fatal-error cleanup exceeds the case limit', async function (scope) {
        const gate = Promise.withResolvers<undefined>();
        const fixture = createInterruptedCase(async function fatalBody(testScope) {
            testScope.cleanup(function slowCleanup() {
                fixture.clock.advanceByMilliseconds(150);
            });
            process.emit('unhandledRejection', new Error('fatal sentinel'), Promise.resolve());
            await gate.promise;
            return testScope.assert.collect();
        }, null);
        scope.cleanup(fixture.stop);
        const result = await fixture.run();
        assert.ok(result.result.outcome?.kind === 'fail');
        scope.assert.deepEqual(
            result.result.outcome.failures.map(function failureKind(failure) {
                return failure.kind;
            }),
            [ 'timeout' ]
        );
        gate.resolve(undefined);
        return scope.assert.collect();
    }),
    test('retains an interruption that arrives while cleanup is pending', async function (scope) {
        const state = { gate: Promise.withResolvers<undefined>(), started: Promise.withResolvers<undefined>() };
        const fixture = createInterruptedCase(function passingBody(testScope) {
            testScope.cleanup(async function pendingCleanup() {
                state.started.resolve(undefined);
                await state.gate.promise;
            });
            testScope.assert.true(true);
            return testScope.assert.collect();
        }, null);
        scope.cleanup(fixture.stop);
        const running = fixture.run();
        await state.started.promise;
        fixture.clock.advanceByMilliseconds(10);
        state.gate.resolve(undefined);
        const result = await running;
        scope.assert.equal(result.result.verdict, 'crashed');
        return scope.assert.collect();
    }),
    test('concurrent finalization waits for the same cleanup and retains its failures', async function (scope) {
        const state = { gate: Promise.withResolvers<undefined>(), controller: new AbortController(), cleanups: 0 };
        const lifecycle = createTestScopeLifecycle(createAssertionRecorder());
        lifecycle.createScope(state.controller.signal).cleanup(async function pendingCleanup() {
            state.cleanups += 1;
            await state.gate.promise;
            throw new Error('single cleanup sentinel');
        });
        const first = lifecycle.finish(state.controller);
        const second = lifecycle.finish(state.controller);
        state.gate.resolve(undefined);
        const results = await Promise.all([ first, second, lifecycle.finish(state.controller) ]);
        scope.assert.equal(state.cleanups, 1);
        scope.assert.true(results.every(function sameFinalization(result) {
            return result === results[0] && result.cleanupErrors.length === 1;
        }));
        return scope.assert.collect();
    })
]);

const { runIfMain } = await import('#test-runner');
await runIfMain(import.meta, testNode);
