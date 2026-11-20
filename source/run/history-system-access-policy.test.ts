import { type TestNode, table, suite, test } from '@overkill-dev/test';

import { historySystemAccess, historySystemScenario } from '../test-support/history-system-access.ts';

export const testNode: TestNode = suite('history system access adaptation', [
    table({
        title: 'classifies history paths',
        cases: [ 'file', 'other', 'symbolic-link', 'missing' ] as const,
        caseTitle(status) {
            return `${status}`;
        },
        async test(scope) {
            const status = scope.parameters;

            const fixture = historySystemAccess({ ...historySystemScenario, status });
            scope.assert.equal(await fixture.runtime.metadata('/state/run'), status === 'missing' ? null : status);
            scope.assert.deepEqual(fixture.calls, [ 'status:/state/run' ]);
            return scope.assert.collect();
        }
    }),
    test('preserves metadata inspection failures', async function (scope) {
        const fixture = historySystemAccess({ ...historySystemScenario, status: 'error' });
        await scope.assert.rejects(async function () {
            await fixture.runtime.metadata('/state/run');
        }, { exact: fixture.failure });
        return scope.assert.collect();
    }),
    table({
        title: 'enumerates history directories',
        cases: [ 'available', 'missing' ] as const,
        caseTitle(names) {
            return `${names}`;
        },
        async test(scope) {
            const names = scope.parameters;

            const fixture = historySystemAccess({ ...historySystemScenario, names });
            scope.assert.deepEqual(await fixture.runtime.names('/state'), names === 'missing' ? [] : [ 'run.json' ]);
            return scope.assert.collect();
        }
    }),
    test('preserves directory enumeration failures', async function (scope) {
        const fixture = historySystemAccess({ ...historySystemScenario, names: 'error' });
        await scope.assert.rejects(async function () {
            await fixture.runtime.names('/state');
        }, { exact: fixture.failure });
        return scope.assert.collect();
    }),
    table({
        title: 'checks owners without sending a signal',
        cases: [ 'alive', 'missing' ] as const,
        caseTitle(owner) {
            return `${owner}`;
        },
        test(scope) {
            const owner = scope.parameters;

            const fixture = historySystemAccess({ ...historySystemScenario, owner });
            scope.assert.equal(fixture.runtime.alive(42), owner === 'alive');
            scope.assert.deepEqual(fixture.calls, [ 'probe:42:0' ]);
            return scope.assert.collect();
        }
    }),
    test('preserves owner probe failures other than missing processes', function (scope) {
        const fixture = historySystemAccess({ ...historySystemScenario, owner: 'error' });
        scope.assert.throws(function () {
            fixture.runtime.alive(42);
        }, { exact: fixture.failure });
        return scope.assert.collect();
    }),
    test('reads UTF-8 metadata and forces requested history removals', async function (scope) {
        const fixture = historySystemAccess(historySystemScenario);
        scope.assert.equal(await fixture.runtime.readText('/state/run'), 'stored text');
        await fixture.runtime.remove('/state/run', false);
        await fixture.runtime.remove('/state/artifacts', true);
        scope.assert.deepEqual(fixture.calls, [
            'read:/state/run:utf8',
            'remove:/state/run:false:true',
            'remove:/state/artifacts:true:true'
        ]);
        return scope.assert.collect();
    }),
    table({
        title: 'checks lease ownership',
        cases: [ false, true ] as const,
        caseTitle(lease) {
            return `${lease}`;
        },
        async test(scope) {
            const lease = scope.parameters;

            const fixture = historySystemAccess({ ...historySystemScenario, lease });
            scope.assert.equal(await fixture.runtime.lease('/state/run', 250), lease);
            scope.assert.deepEqual(fixture.calls, [ 'lease:/state/run:/state/run.lease:250' ]);
            scope.assert.equal(fixture.runtime.host(), 'unit-host');
            scope.assert.equal(await fixture.runtime.canonical('/state'), '/state');
            return scope.assert.collect();
        }
    })
]);
