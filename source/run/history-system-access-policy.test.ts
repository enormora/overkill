import { type TestScope, suite as authoredSuite, test as authoredTest } from '@overkill-dev/test';

import { historySystemAccess, historySystemScenario } from '../test-support/history-system-access.ts';

export const testNode = authoredSuite('history system access adaptation', [
    ...([ 'file', 'other', 'symbolic-link', 'missing' ] as const).map(function (status) {
        return authoredTest(`classifies ${status} history paths`, async function (scope: TestScope) {
            const fixture = historySystemAccess({ ...historySystemScenario, status });
            scope.assert.equal(await fixture.runtime.metadata('/state/run'), status === 'missing' ? null : status);
            scope.assert.deepEqual(fixture.calls, [ 'status:/state/run' ]);
            return scope.assert.collect();
        });
    }),
    authoredTest('preserves metadata inspection failures', async function (scope: TestScope) {
        const fixture = historySystemAccess({ ...historySystemScenario, status: 'error' });
        await scope.assert.rejects(async function () {
            await fixture.runtime.metadata('/state/run');
        }, { exact: fixture.failure });
        return scope.assert.collect();
    }),
    ...([ 'available', 'missing' ] as const).map(function (names) {
        return authoredTest(`enumerates ${names} history directories`, async function (scope: TestScope) {
            const fixture = historySystemAccess({ ...historySystemScenario, names });
            scope.assert.deepEqual(await fixture.runtime.names('/state'), names === 'missing' ? [] : [ 'run.json' ]);
            return scope.assert.collect();
        });
    }),
    authoredTest('preserves directory enumeration failures', async function (scope: TestScope) {
        const fixture = historySystemAccess({ ...historySystemScenario, names: 'error' });
        await scope.assert.rejects(async function () {
            await fixture.runtime.names('/state');
        }, { exact: fixture.failure });
        return scope.assert.collect();
    }),
    ...([ 'alive', 'missing' ] as const).map(function (owner) {
        return authoredTest(`checks ${owner} owners without sending a signal`, function (scope: TestScope) {
            const fixture = historySystemAccess({ ...historySystemScenario, owner });
            scope.assert.equal(fixture.runtime.alive(42), owner === 'alive');
            scope.assert.deepEqual(fixture.calls, [ 'probe:42:0' ]);
            return scope.assert.collect();
        });
    }),
    authoredTest('preserves owner probe failures other than missing processes', function (scope: TestScope) {
        const fixture = historySystemAccess({ ...historySystemScenario, owner: 'error' });
        scope.assert.throws(function () {
            fixture.runtime.alive(42);
        }, { exact: fixture.failure });
        return scope.assert.collect();
    }),
    authoredTest('reads UTF-8 metadata and forces requested history removals', async function (scope: TestScope) {
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
    ...([ false, true ] as const).map(function (lease) {
        return authoredTest(`checks lease ownership with result ${lease}`, async function (scope: TestScope) {
            const fixture = historySystemAccess({ ...historySystemScenario, lease });
            scope.assert.equal(await fixture.runtime.lease('/state/run', 250), lease);
            scope.assert.deepEqual(fixture.calls, [ 'lease:/state/run:/state/run.lease:250' ]);
            scope.assert.equal(fixture.runtime.host(), 'unit-host');
            scope.assert.equal(await fixture.runtime.canonical('/state'), '/state');
            return scope.assert.collect();
        });
    })
]);
