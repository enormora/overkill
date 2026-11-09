import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { baselineCaseEvent, baselineCaseResult, storedBaseline } from '../test-support/baseline-case-fixture.ts';
import { defaultRunRequest } from '../test-support/run-command-factory.ts';
import type { OrdinaryBaselinePolicy } from '../baselines/baseline-policy.ts';
import { belongsToBaselineScope, reconcileBaselineInventory } from './baseline-inventory.ts';

const policy: OrdinaryBaselinePolicy = { adapters: [], directory: 'test-baselines', snapshots: false, stale: 'fail' };
const inventory = {
    policy,
    request: defaultRunRequest({ profile: 'unit' }),
    result: baselineCaseResult,
    existing: [ storedBaseline ],
    participating: []
};
export const testNode = suite('ordinary baseline inventories', [
    test('preserves incompatible snapshot codecs and foreign contexts', function (scope) {
        const snapshots = { ...policy, snapshots: true };
        const record = {
            ...storedBaseline,
            adapter: 'overkill.content-snapshot',
            comparisonContext: { codec: '1', name: 'response', format: 'text' }
        };
        scope.assert.true(belongsToBaselineScope(snapshots, record.profile, record));
        scope.assert.false(belongsToBaselineScope(snapshots, record.profile, {
            ...record,
            comparisonContext: { ...record.comparisonContext, codec: '2' }
        }));
        scope.assert.false(belongsToBaselineScope(snapshots, record.profile, {
            ...record,
            comparisonContext: { ...record.comparisonContext, domain: 'other' }
        }));
        scope.assert.false(belongsToBaselineScope(policy, record.profile, record));
        return scope.assert.collect();
    }),
    test('rejects unobserved stale expectations in normal runs', function (scope: TestScope) {
        const completed = reconcileBaselineInventory(inventory);
        scope.assert.equal(completed.result.status, 'failed');
        scope.assert.equal(completed.result.runnerErrors[0]?.subtype, 'artifact');
        scope.assert.deepEqual(completed.changes, []);
        scope.assert.deepEqual(completed.warnings, []);
        return scope.assert.collect();
    }),
    test('can warn about stale expectations without failing comparisons', function (scope: TestScope) {
        const completed = reconcileBaselineInventory({ ...inventory, policy: { ...policy, stale: 'warn' } });
        scope.assert.equal(completed.result.status, 'passed');
        scope.assert.deepEqual(completed.changes, []);
        scope.assert.equal(completed.warnings.length, 1);
        return scope.assert.collect();
    }),
    test('preserves stale records for every incomplete selection', function (scope: TestScope) {
        for (
            const overrides of [
                { paths: [ 'output.test.ts' ] },
                { shard: { total: 2, index: 1 } },
                { lastFailed: true },
                {
                    selection: {
                        kind: 'filter' as const,
                        filter: { kind: 'case-id' as const, id: baselineCaseEvent.case }
                    }
                }
            ]
        ) {
            const completed = reconcileBaselineInventory({
                ...inventory,
                request: { ...inventory.request, ...overrides, baselineUpdateMode: 'apply' }
            });
            scope.assert.equal(completed.result, baselineCaseResult);
            scope.assert.deepEqual(completed.changes, []);
            scope.assert.deepEqual(completed.warnings, []);
        }
        return scope.assert.collect();
    }),
    test('preserves stale records when execution or collection is incomplete', function (scope: TestScope) {
        for (
            const result of [
                { ...baselineCaseResult, status: 'failed' as const },
                { ...baselineCaseResult, planStatus: 'empty-selection' as const },
                { ...baselineCaseResult, summary: { ...baselineCaseResult.summary, planned: 2 } },
                {
                    ...baselineCaseResult,
                    perTest: baselineCaseResult.perTest.map(function (entry) {
                        return { ...entry, verdict: 'fail' as const };
                    })
                }
            ]
        ) {
            const completed = reconcileBaselineInventory({
                ...inventory,
                result,
                request: { ...inventory.request, baselineUpdateMode: 'apply' }
            });
            scope.assert.deepEqual(completed.changes, []);
        }
        return scope.assert.collect();
    }),
    test('preserves skipped cases even when they cannot observe', function (scope: TestScope) {
        const result = {
            ...baselineCaseResult,
            perTest: baselineCaseResult.perTest.map(function (entry) {
                return { ...entry, verdict: 'skip' as const };
            })
        };
        const completed = reconcileBaselineInventory({ ...inventory, result });
        scope.assert.equal(completed.result, result);
        scope.assert.deepEqual(completed.changes, []);
        return scope.assert.collect();
    }),
    test('excludes foreign profiles and adapter contexts from the selected scope', function (scope: TestScope) {
        const adapter = {
            id: 'output',
            subtype: 'content-snapshot' as const,
            comparisonContext: {},
            async evaluate() {
                return { kind: 'not-applicable' as const };
            }
        };
        const configured = { ...policy, adapters: [ adapter ] };
        scope.assert.true(belongsToBaselineScope(configured, 'unit', storedBaseline));
        for (
            const baseline of [
                { ...storedBaseline, profile: 'other' },
                { ...storedBaseline, adapter: 'foreign' },
                { ...storedBaseline, subtype: 'visual-snapshot' as const },
                { ...storedBaseline, comparisonContext: { machine: 'other' } }
            ]
        ) {
            scope.assert.false(belongsToBaselineScope(configured, 'unit', baseline));
        }
        return scope.assert.collect();
    })
]);
