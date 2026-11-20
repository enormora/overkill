import { type TestNode, table, type TestScope, suite, test } from '@overkill-dev/test';
import { AsyncLocalStorage } from 'node:async_hooks';

import { globalErrorObservation } from '../test-support/global-error-observation.ts';
import { withRunnerInfrastructure } from '../execution-ownership.ts';
import { observeActiveCaseWork } from './execution-global-error-observer.ts';
import { executionErrorOwnership } from './execution-error-ownership.ts';

export const testNode: TestNode = suite('global error attribution boundaries', [
    test('leaves work subscriptions empty outside an execution boundary', function (scope) {
        const observed: string[] = [];
        const storage = executionErrorOwnership().runScopeStorage;
        if (!(storage instanceof AsyncLocalStorage)) {
            throw new TypeError('Expected native execution context storage.');
        }
        storage.exit(function () {
            const stop = observeActiveCaseWork(function (work) {
                observed.push(work.case.title);
            });
            stop();
        });
        scope.assert.deepEqual(observed, []);
        return scope.assert.collect();
    }),
    test('serializes errors without a stack', async function (scope) {
        const fixture = globalErrorObservation();
        const failure = new Error('stackless');
        Reflect.deleteProperty(failure, 'stack');
        await fixture.observer.runBoundary(async function () {
            fixture.events.emit('unhandledRejection', failure);
        });
        scope.assert.partialDeepEqual<unknown, unknown>(fixture.observer.takeErrors()[0]?.cause, {
            reason: { name: 'Error', message: 'stackless', stack: null }
        });
        return scope.assert.collect();
    }),
    test('keeps infrastructure errors at run level while a case is active', async function (scope: TestScope) {
        const fixture = globalErrorObservation();
        await fixture.observer.runBoundary(async function () {
            await fixture.observer.runCase(fixture.testCase, { index: 0 }, async function () {
                withRunnerInfrastructure(function () {
                    fixture.events.emit('uncaughtException', new Error('Infrastructure failed.'));
                });
            });
        });
        const error = fixture.observer.takeErrors()[0];
        scope.require.defined(error);
        scope.assert.equal(error.attributedTo, null);
        scope.assert.includes(error.message, 'Infrastructure failed.');
        return scope.assert.collect();
    }),
    table({
        title: 'retains denied permissions across case ownership states',
        cases: [ false, true ],
        caseTitle(active) {
            return `${active}`;
        },
        async test(scope) {
            const require: typeof scope.require = scope.require;

            const active = scope.parameters;

            const fixture = globalErrorObservation();
            async function denied(): Promise<void> {
                fixture.events.emit(
                    'unhandledRejection',
                    Object.assign(new Error('Access denied'), {
                        code: 'ERR_ACCESS_DENIED',
                        permission: 'FileSystemRead',
                        resource: '/project/input.ts'
                    })
                );
            }
            await fixture.observer.runBoundary(async function () {
                if (active) {
                    await fixture.observer.runCase(fixture.testCase, { index: 2 }, denied);
                } else {
                    await fixture.observer.runPhase('collection', denied);
                }
            });
            const error = fixture.observer.takeErrors()[0];
            require.defined(error);
            scope.assert.equal(error.subtype, 'permission');
            scope.assert.deepEqual({ attributedTo: error.attributedTo }, {
                attributedTo: active ? fixture.testCase.id : null
            });
            return scope.assert.collect();
        }
    })
]);
