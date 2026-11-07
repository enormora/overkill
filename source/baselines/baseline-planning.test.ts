import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { createCaseId, createDefaultWorkId } from '../engine/identity.ts';
import {
    baselineIdentityKey,
    findStaleBaselines,
    planBaselineChange,
    type BaselineAdapter,
    type BaselineIdentity,
    type BaselineUpdateMode
} from '../packages/baselines/baselines.entry-point.ts';

const identity: BaselineIdentity = {
    adapter: 'output',
    profile: 'integration',
    subtype: 'content-snapshot',
    comparisonContext: {},
    work: createDefaultWorkId(createCaseId('output.test.ts', [], 'output', null))
};
export const testNode = suite('shared baseline planning', [
    test('preserves expectations without calling proposal callbacks', function (scope: TestScope) {
        for (const mode of [ 'none', 'bootstrap' ] as const) {
            scope.assert.equal(
                planBaselineChange({
                    mode,
                    existing: 'stored',
                    propose() {
                        throw new Error('Unexpected proposal');
                    },
                    equals: Object.is
                }),
                null
            );
        }
        return scope.assert.collect();
    }),
    test('creates missing records and preserves equal expectations', function (scope: TestScope) {
        const modes: readonly BaselineUpdateMode[] = [ 'apply', 'bootstrap', 'diff', 'update' ];
        for (const mode of modes) {
            const creation = planBaselineChange({
                mode,
                existing: null,
                propose() {
                    return 'new';
                },
                equals: Object.is
            });
            scope.assert.equal(creation?.kind, 'create');
            scope.assert.equal(creation?.baseline, 'new');
        }
        scope.assert.equal(
            planBaselineChange({
                mode: 'update',
                existing: 'same',
                propose() {
                    return 'same';
                },
                equals: Object.is
            }),
            null
        );
        return scope.assert.collect();
    }),
    test('updates existing records only in replacement modes', function (scope: TestScope) {
        const modes: readonly BaselineUpdateMode[] = [ 'apply', 'bootstrap', 'diff', 'update' ];
        for (const mode of modes) {
            const change = planBaselineChange({
                mode,
                existing: 'old',
                propose() {
                    return 'new';
                },
                equals: Object.is
            });
            if (mode === 'bootstrap') {
                scope.assert.equal(change, null);
            } else {
                if (change === null) {
                    throw new Error('Missing baseline update');
                }
                scope.assert.deepEqual(change, { kind: 'update', baseline: 'new', previous: 'old' });
            }
        }
        return scope.assert.collect();
    }),
    test('canonicalizes contexts and distinguishes identity dimensions', function (scope: TestScope) {
        scope.assert.equal(
            baselineIdentityKey({ ...identity, comparisonContext: { a: 'é', b: '2' } }),
            baselineIdentityKey({ ...identity, comparisonContext: { b: '2', a: 'é' } })
        );
        for (
            const variant of [
                { ...identity, profile: 'other' },
                { ...identity, adapter: 'other' },
                { ...identity, comparisonContext: { machine: 'other' } },
                { ...identity, subtype: 'visual-snapshot' as const },
                { ...identity, work: { ...identity.work, workload: { name: 'large', params: {} } } }
            ]
        ) {
            scope.assert.notEqual(baselineIdentityKey(identity), baselineIdentityKey(variant));
        }
        return scope.assert.collect();
    }),
    test('requires complete inventory and preserves participating and skipped cases', function (scope: TestScope) {
        const stale = { ...identity, adapter: 'retired' };
        const identify = function (baseline: BaselineIdentity): BaselineIdentity {
            return baseline;
        };
        scope.assert.deepEqual(findStaleBaselines([ identity, stale ], { kind: 'incomplete' }, identify), []);
        scope.assert.deepEqual(
            findStaleBaselines([ identity, stale ], {
                kind: 'complete',
                participating: [ identity ],
                preservedCases: []
            }, identify),
            [ stale ]
        );
        scope.assert.deepEqual(
            findStaleBaselines([ stale ], {
                kind: 'complete',
                participating: [],
                preservedCases: [ identity.work.case ]
            }, identify),
            []
        );
        return scope.assert.collect();
    }),
    test('supports asynchronous binary adapters with domain comparison', async function (scope: TestScope) {
        const adapter: BaselineAdapter<Uint8Array, Uint8Array, Uint8Array, Uint8Array, string> = {
            id: 'bytes',
            async observe(value) {
                return { kind: 'observed', value };
            },
            async propose(input) {
                return input.actual;
            },
            async compare(input) {
                return input.actual[0] === input.expected[0]
                    ? { kind: 'match' }
                    : { kind: 'mismatch', diagnostics: [ 'first byte differs' ] };
            }
        };
        const actual = new Uint8Array([ 1, 2 ]);
        scope.assert.deepEqual(await adapter.observe(actual), { kind: 'observed', value: actual });
        scope.assert.deepEqual(await adapter.propose({ actual, expected: null }), actual);
        scope.assert.deepEqual(await adapter.compare({ actual, expected: new Uint8Array([ 2 ]) }), {
            kind: 'mismatch',
            diagnostics: [ 'first byte differs' ]
        });
        scope.assert.deepEqual(await adapter.compare({ actual, expected: new Uint8Array([ 1, 99 ]) }), {
            kind: 'match'
        });
        return scope.assert.collect();
    })
]);
