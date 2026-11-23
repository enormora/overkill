import assert from 'node:assert/strict';
import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { table, type TestScope, suite, test } from '@overkill-dev/test';

import { createStoredValue, type StoredValue } from '../stored-value.ts';
import { createInterruptedCase, type InterruptedCase } from '../test-support/interrupted-case.ts';
import { createPermissionDenialRuntimePolicy } from '../run/capability-policy.ts';
import { createAssertionRecorder } from './assertion-recorder.ts';
import { createTestScopeLifecycle, type TestScopeLifecycle } from './test-scope-lifecycle.ts';
import type { ConcurrentCase } from './execution-supervision.ts';

type RegistrationProbe = { readonly registerCleanup: () => void; readonly startWork: () => void; };

type CleanupState = {
    readonly body: PromiseWithResolvers<undefined>;
    readonly cleanup: PromiseWithResolvers<undefined>;
    readonly started: PromiseWithResolvers<undefined>;
    readonly events: readonly string[];
    readonly registrations: readonly RegistrationProbe[];
    readonly returned: StoredValue<boolean>;
    readonly recordEvent: (event: string) => void;
    readonly observeRegistration: (registration: RegistrationProbe) => void;
};

type CleanupProbe = CleanupState & { readonly fixture: InterruptedCase; };

function createCleanupProbe(cleanup: TestScope['cleanup']): CleanupProbe {
    const events: string[] = [];
    const registrations: RegistrationProbe[] = [];
    const state: CleanupState = {
        body: Promise.withResolvers<undefined>(),
        cleanup: Promise.withResolvers<undefined>(),
        started: Promise.withResolvers<undefined>(),
        events,
        registrations,
        returned: createStoredValue(false),
        recordEvent(event) {
            events.push(event);
        },
        observeRegistration(registration) {
            registrations.push(registration);
        }
    };
    const fixture = createInterruptedCase(async function pendingBody(testScope) {
        state.observeRegistration({
            registerCleanup() {
                testScope.cleanup(function lateCleanup() {
                    state.recordEvent('late');
                });
            },
            startWork() {
                testScope.startInFlight(async function lateOperation() {
                    state.recordEvent('late operation');
                });
            }
        });
        testScope.cleanup(function firstCleanup() {
            state.recordEvent('first');
        });
        testScope.cleanup(async function secondCleanup() {
            assert.equal(testScope.signal.aborted, true);
            state.recordEvent('second');
            state.started.resolve(undefined);
            await state.cleanup.promise;
        });
        testScope.assert.true(true);
        const assertions = testScope.assert.collect();
        await state.body.promise;
        return assertions;
    }, null);
    cleanup(fixture.stop);
    return { ...state, fixture };
}

async function trackedExecution(probe: CleanupProbe): Promise<ConcurrentCase> {
    const result = await probe.fixture.run();
    probe.returned.write(true);
    return result;
}

type BlockedCleanup = { readonly running: Promise<ConcurrentCase>; };
async function beginBlockedCleanup(probe: CleanupProbe): Promise<BlockedCleanup> {
    const running = trackedExecution(probe);
    probe.fixture.clock.advanceByMilliseconds(10);
    await probe.started.promise;
    return { running };
}
async function releaseLateBody(
    probe: CleanupProbe,
    result: ConcurrentCase,
    yieldToNextTurn: TestScope['yieldToNextTurn']
): Promise<ConcurrentCase> {
    const snapshot = structuredClone(result);
    probe.body.resolve(undefined);
    await yieldToNextTurn();
    return snapshot;
}

const assertClosedRegistration = defineCompositeAssertion({
    name: 'closed registration',
    assert(check, probe: CleanupProbe) {
        const captured = probe.registrations[0];
        if (captured === undefined) {
            return check.defined(captured);
        }
        return check.group([
            check.throws(captured.registerCleanup, { message: /cannot be called after test cleanup/ }),
            check.throws(captured.startWork, { message: /cannot be called after test cleanup/ })
        ]);
    }
});

const assertCleanupFailures = defineCompositeAssertion({
    name: 'cleanup failures',
    assert(check, result: ConcurrentCase) {
        assert.ok(result.result.outcome?.kind === 'fail');
        return check.deepEqual(
            result.result.outcome.failures.map(function cleanupMessage(failure) {
                assert.ok(failure.kind === 'cleanup-error');
                return failure.error.message;
            }),
            [ 'preparation sentinel', 'cleanup sentinel' ]
        );
    }
});

const cleanupRemainsPending = defineCompositeAssertion({
    name: 'cleanup remains pending',
    assert(check, probe: CleanupProbe) {
        return check.group([
            check.false(probe.returned.read()),
            check.deepEqual(Array.from(probe.events), [ 'second' ])
        ]);
    }
});

function prepareScopeLifecycle(): TestScopeLifecycle {
    const work = {
        familyVariant: null,
        case: { file: null, suite: [], title: 'case', params: null },
        runtimes: [],
        workload: null
    };
    const recorder = createAssertionRecorder({ case: work.case, work, attempt: { index: 0 }, trial: null });
    return createTestScopeLifecycle(recorder, { seed: 0n, work });
}

export const testNode = suite('interrupted case cleanup', [
    test('closes assertions before the interruption signal is delivered', async function (scope) {
        const gate = Promise.withResolvers<undefined>();
        const fixture = createInterruptedCase(async function pendingBody(testScope) {
            testScope.assert.true(true);
            const assertions = testScope.assert.collect();
            testScope.signal.addEventListener('abort', function recordAfterInterruption() {
                try {
                    testScope.assert.true(false);
                } catch {
                }
            }, { once: true });
            await gate.promise;
            return assertions;
        }, null);
        scope.cleanup(fixture.stop);
        const running = fixture.run();
        fixture.clock.advanceByMilliseconds(10);
        const { result } = await running;
        gate.resolve(undefined);
        scope.assert.deepEqual([ result.verdict, result.outcome ], [ 'crashed', null ]);
        scope.assert.partialDeepEqual<unknown, unknown>(result.attempts[0].outcome, {
            kind: 'fail',
            failures: [ { code: 'late-assertion-activity', actual: { closure: 'interrupted' } } ]
        });
        return scope.assert.collect();
    }),
    test('awaits reverse cleanup before returning while the body remains pending', async function (scope) {
        const probe = createCleanupProbe(scope.cleanup);

        const { running } = await beginBlockedCleanup(probe);
        scope.assert(cleanupRemainsPending, probe);
        probe.cleanup.resolve(undefined);
        const finishInterruptedCleanupResult = await running;
        scope.assert(
            defineCompositeAssertion({
                name: 'awaits reverse cleanup before returning while the body remains pending',
                assert(check) {
                    return check.group([
                        check.equal(finishInterruptedCleanupResult.result.verdict, 'crashed'),
                        check.deepEqual(probe.events, [ 'second', 'first' ])
                    ]);
                }
            })
        );

        const verifyLateBodySnapshot = await releaseLateBody(
            probe,
            finishInterruptedCleanupResult,
            scope.yieldToNextTurn
        );
        scope.assert(
            defineCompositeAssertion({
                name: 'awaits reverse cleanup before returning while the body remains pending',
                assert(check) {
                    return check.group([
                        check.deepEqual(probe.events, [ 'second', 'first' ]),
                        check.deepEqual(finishInterruptedCleanupResult, verifyLateBodySnapshot)
                    ]);
                }
            })
        );
        scope.assert(assertClosedRegistration, probe);

        return scope.assert.collect();
    }),
    table({
        title: 'closes pending body scopes after fatal hooks',
        cases: [ 'unhandledRejection', 'uncaughtException' ] as const,
        caseTitle(hook) {
            return hook;
        },
        async test(scope) {
            const state = { gate: Promise.withResolvers<undefined>(), cleanups: createStoredValue(0) };
            const fixture = createInterruptedCase(async function fatalBody(testScope) {
                testScope.cleanup(function recordCleanup() {
                    state.cleanups.write(state.cleanups.read() + 1);
                });
                testScope.assert.true(true);
                const assertions = testScope.assert.collect();
                process.emit(scope.parameters, new Error('fatal sentinel'), Promise.resolve());
                await state.gate.promise;
                return assertions;
            }, null);
            scope.cleanup(fixture.stop);
            const result = await fixture.run();
            scope.assert.equal(result.result.verdict, 'crashed');
            scope.assert.equal(state.cleanups.read(), 1);
            state.gate.resolve(undefined);
            await scope.yieldToNextTurn();
            scope.assert.equal(state.cleanups.read(), 1);
            return scope.assert.collect();
        }
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
            testScope.assert.true(true);
            const assertions = testScope.assert.collect();
            await state.gate.promise;
            return assertions;
        }, {
            ...state.policy,
            async prepareAttempt() {
                throw new Error('preparation sentinel');
            }
        });
        scope.cleanup(fixture.stop);
        const running = fixture.run();
        fixture.clock.advanceByMilliseconds(10);
        scope.assert(assertCleanupFailures, await running);
        state.gate.resolve(undefined);
        return scope.assert.collect();
    }),
    test('retains a soft timeout when fatal-error cleanup exceeds the case limit', async function (scope) {
        const gate = Promise.withResolvers<undefined>();
        const fixture = createInterruptedCase(async function fatalBody(testScope) {
            testScope.cleanup(function slowCleanup() {
                fixture.clock.advanceByMilliseconds(150);
            });
            testScope.assert.true(true);
            const assertions = testScope.assert.collect();
            process.emit('unhandledRejection', new Error('fatal sentinel'), Promise.resolve());
            await gate.promise;
            return assertions;
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
    test(
        'concurrent finalization waits for the same cleanup and retains its failures',
        async function (scope) {
            const state = { gate: Promise.withResolvers<undefined>(), controller: new AbortController(), cleanups: 0 };
            const lifecycle = prepareScopeLifecycle();
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
        }
    )
]);
