import { type TestScope, suite as authoredSuite, test } from '@overkill-dev/test';

import { projectedResourceLifecycle } from '../test-support/projected-resource-lifecycle.ts';
import { managedCase } from '../test-support/managed-resource-acquisition.ts';
import { createResourceLifecycleSession, acquireResourceLifecycleScopes } from './resource-lifecycle.ts';

export const testNode = authoredSuite('projected resource session ownership', [
    test('merges later projections by owner boundary before acquisition', async function (scope: TestScope) {
        const fixture = projectedResourceLifecycle();
        fixture.session.updateProjectedResources({
            resources: [ { boundaryKey: 'unrelated', payload: 'other' }, {
                boundaryKey: fixture.boundary,
                payload: 'replacement'
            } ]
        });
        scope.assert.equal(await fixture.use(scope.signal), 'consumer:replacement');
        scope.assert.deepEqual(fixture.session.projectionRecords(), { resources: [] });
        scope.assert.deepEqual(await fixture.session.disposeAll(scope.signal), []);
        return scope.assert.collect();
    }),
    test('prepares selected work and completes each external owner boundary', async function (scope: TestScope) {
        const fixture = projectedResourceLifecycle();
        scope.assert.equal(await fixture.use(scope.signal), 'consumer:initial');
        scope.assert.deepEqual(await fixture.session.prepareAttempt(fixture.testCase.workId, { index: 0 }), []);
        scope.assert.deepEqual(await fixture.session.completeBoundaries([ fixture.boundary ]), []);
        scope.assert.deepEqual(await fixture.session.completeBoundaries([ fixture.boundary ]), []);
        scope.assert.deepEqual(await fixture.session.disposeAll(scope.signal), []);
        return scope.assert.collect();
    }),
    test('rejects work outside the owning session without affecting valid work', async function (scope: TestScope) {
        const fixture = projectedResourceLifecycle();
        await scope.assert.rejects(async function () {
            await fixture.session.prepareAttempt({
                ...fixture.testCase.workId,
                case: { ...fixture.testCase.id, title: 'unknown' }
            }, { index: 0 });
        }, { message: 'Resource preparation is outside the owner session.' });
        scope.assert.deepEqual(await fixture.session.prepareAttempt(fixture.testCase.workId, { index: 1 }), []);
        await fixture.session.disposeAll(scope.signal);
        return scope.assert.collect();
    }),
    test(
        'runs load operations through a resource policy without altering their value',
        async function (scope: TestScope) {
            const session = createResourceLifecycleSession({
                testCases: [],
                boundaryUseCounts: [],
                caseDisposalScopes: new Set(),
                projectedResources: { resources: [] },
                timing: null
            });
            scope.assert.equal(
                await session.runtimePolicy.runLoad(async function () {
                    return 42;
                }),
                42
            );
            scope.assert.deepEqual(await session.disposeAll(scope.signal), []);
            return scope.assert.collect();
        }
    ),
    test('exposes preparation and completion for explicitly acquired empty scopes', async function (scope: TestScope) {
        const testCase = managedCase();
        const session = await acquireResourceLifecycleScopes({
            options: {
                testCases: [ testCase ],
                boundaryUseCounts: [],
                caseDisposalScopes: new Set(),
                projectedResources: { resources: [] },
                timing: null
            },
            boundaryKeys: new Set(),
            scopes: new Set(),
            signal: scope.signal,
            stepsForCase() {
                return [];
            },
            testCases: [ testCase ]
        });
        scope.assert.deepEqual(await session.prepareAttempt(testCase.workId, { index: 0 }), []);
        scope.assert.deepEqual(await session.completeBoundaries([]), []);
        scope.assert.deepEqual(session.projectionRecords(), { resources: [] });
        scope.assert.deepEqual(await session.disposeAll(scope.signal), []);
        return scope.assert.collect();
    })
]);
