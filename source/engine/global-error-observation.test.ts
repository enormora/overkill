import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { globalErrorObservation } from '../test-support/global-error-observation.ts';
import { createOwnedGlobalErrorObserver } from './execution-global-error-observer.ts';

export const testNode = suite('global execution error ownership', [
    test('publishes current and newly active work until the subscription stops', async function (scope: TestScope) {
        const fixture = globalErrorObservation();
        const observed: string[] = [];
        await fixture.observer.runBoundary(async function () {
            const boundary = fixture.ownership.runScopeStorage.getStore();
            scope.require.defined(boundary);
            const stop = boundary.observeActiveWork(function (work) {
                observed.push(work.case.title);
            });
            await fixture.observer.runCase(fixture.testCase, { index: 0 }, async function () {
                const stopCurrent = boundary.observeActiveWork(function (work) {
                    observed.push(`current:${work.case.title}`);
                });
                stopCurrent();
            });
            stop();
            await fixture.observer.runCase(fixture.testCase, { index: 1 }, async function () {
                await Promise.resolve();
            });
        });
        scope.assert.deepEqual(observed, [ 'case', 'current:case' ]);
        return scope.assert.collect();
    }),
    test('ignores errors retained by a stopped boundary', async function (scope: TestScope) {
        const fixture = globalErrorObservation();
        await fixture.observer.runBoundary(async function () {
            const boundary = fixture.ownership.runScopeStorage.getStore();
            scope.require.defined(boundary);
            fixture.events.emit('unhandledRejection', new Error('before stop'));
            const error = fixture.observer.takeErrors()[0];
            scope.require.defined(error);
            fixture.observer.stop();
            boundary.recordError(error);
        });
        scope.assert.deepEqual(fixture.observer.takeErrors(), []);
        return scope.assert.collect();
    }),

    test('installs hooks only while its boundary runs', async function (scope: TestScope) {
        const fixture = globalErrorObservation();
        const result = await fixture.observer.runBoundary(async function () {
            scope.assert.equal(fixture.events.listenerCount('uncaughtException'), 1);
            scope.assert.equal(fixture.events.listenerCount('unhandledRejection'), 1);
            return 42;
        });
        scope.assert.equal(result, 42);
        scope.assert.equal(fixture.events.listenerCount('uncaughtException'), 0);
        scope.assert.equal(fixture.events.listenerCount('unhandledRejection'), 0);
        scope.assert.deepEqual(fixture.observer.takeErrors(), []);
        return scope.assert.collect();
    }),
    ...([ 'uncaughtException', 'unhandledRejection' ] as const).map(function (hook) {
        return test(`attributes ${hook} to the active case and attempt`, async function (scope: TestScope) {
            const fixture = globalErrorObservation();
            await fixture.observer.runBoundary(async function () {
                await fixture.observer.runCase(fixture.testCase, { index: 2 }, async function () {
                    fixture.events.emit(hook, new Error('Body failed.'));
                });
            });
            const error = fixture.observer.takeErrors()[0];
            scope.require.defined(error);
            scope.assert.deepEqual<unknown, unknown>(error.attributedTo, fixture.testCase.id);
            scope.assert.deepEqual<unknown, unknown>(error.attributedToWork, fixture.testCase.workId);
            scope.assert.deepEqual<unknown, unknown>(error.attributedToAttempt, { index: 2 });
            scope.assert.includes(error.message, 'Body failed.');
            scope.assert.true(fixture.observer.hasFatalError());
            return scope.assert.collect();
        });
    }),
    test('retains run-level collection failures without assigning a case', async function (scope: TestScope) {
        const fixture = globalErrorObservation();
        await fixture.observer.runBoundary(async function () {
            await fixture.observer.runPhase('collection', async function () {
                fixture.events.emit('unhandledRejection', 'Collection failed.');
            });
        });
        const error = fixture.observer.takeErrors()[0];
        scope.require.defined(error);
        scope.assert.deepEqual({ attributedTo: error.attributedTo, subtype: error.subtype }, {
            attributedTo: null,
            subtype: 'unhandled-rejection'
        });
        scope.assert.includes(error.message, 'Collection failed.');
        scope.assert.deepEqual<unknown, unknown>(error.cause, {
            boundary: 'in-process',
            hook: 'unhandledRejection',
            origin: { attempt: null, case: null, work: null },
            phase: 'collection',
            reason: { message: 'Collection failed.', name: 'Error', stack: null }
        });
        return scope.assert.collect();
    }),
    test('resolves fatal signals and removes unsubscribed handlers', async function (scope: TestScope) {
        const fixture = globalErrorObservation();
        const received: string[] = [];
        const remove = fixture.observer.onFatalError(function (error) {
            received.push(error.message);
        });
        await Promise.all([
            fixture.observer.fatalSignal(),
            fixture.observer.runBoundary(async function () {
                fixture.events.emit('uncaughtException', new Error('First failure.'));
            })
        ]);
        remove();
        await fixture.observer.runBoundary(async function () {
            fixture.events.emit('uncaughtException', new Error('Second failure.'));
        });
        await fixture.observer.fatalSignal();
        scope.assert.deepEqual(received, [ 'Uncaught exception: First failure.' ]);
        return scope.assert.collect();
    }),
    test('drains recorded errors without clearing fatal state', async function (scope: TestScope) {
        const fixture = globalErrorObservation();
        await fixture.observer.runBoundary(async function () {
            fixture.events.emit('unhandledRejection', new Error('Failure.'));
        });
        scope.assert.equal(fixture.observer.takeErrors().length, 1);
        scope.assert.deepEqual(fixture.observer.takeErrors(), []);
        scope.assert.true(fixture.observer.hasFatalError());
        return scope.assert.collect();
    }),
    test('removes hooks and ignores events after an explicit stop', async function (scope: TestScope) {
        const fixture = globalErrorObservation();
        await fixture.observer.runBoundary(async function () {
            fixture.observer.stop();
            fixture.events.emit('uncaughtException', new Error('Late failure.'));
        });
        scope.assert.deepEqual(fixture.observer.takeErrors(), []);
        scope.assert.false(fixture.observer.hasFatalError());
        scope.assert.equal(fixture.events.listenerCount('uncaughtException'), 0);
        return scope.assert.collect();
    }),
    test('preserves attribution ambiguity when multiple boundaries overlap', async function (scope: TestScope) {
        const fixture = globalErrorObservation();
        const sibling = createOwnedGlobalErrorObserver('worker-pool-host', fixture.ownership);
        const completed = Promise.withResolvers<undefined>();
        const first = fixture.observer.runBoundary(async function () {
            await completed.promise;
        });
        const second = sibling.runBoundary(async function () {
            await completed.promise;
        });
        fixture.events.emit('unhandledRejection', new Error('Unowned failure.'));
        completed.resolve(undefined);
        await Promise.all([ first, second ]);
        scope.assert.deepEqual([ fixture.observer.takeErrors()[0]?.subtype, sibling.takeErrors()[0]?.subtype ], [
            'attribution-drift',
            'attribution-drift'
        ]);
        return scope.assert.collect();
    }),
    test('retains drift evidence for events delivered after their attempt ended', async function (scope: TestScope) {
        const fixture = globalErrorObservation();
        const trigger = Promise.withResolvers<undefined>();
        const pending: Promise<void>[] = [];
        await fixture.observer.runBoundary(async function () {
            await fixture.observer.runCase(fixture.testCase, { index: 0 }, async function () {
                async function observeAfterAttempt(): Promise<void> {
                    await trigger.promise;
                    fixture.events.emit('unhandledRejection', new Error('Late failure.'));
                }
                pending.push(observeAfterAttempt());
            });
            trigger.resolve(undefined);
            await Promise.all(pending);
        });
        const error = fixture.observer.takeErrors()[0];
        scope.require.defined(error);
        scope.assert.equal(error.subtype, 'attribution-drift');
        scope.assert.equal(error.attributedTo, null);
        scope.assert.includes(error.message, 'Late failure.');
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
