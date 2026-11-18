import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { storedBaseline } from '../test-support/baseline-case-fixture.ts';
import { memoryOrdinaryBaselines } from '../test-support/memory-ordinary-baselines.ts';
import { createBaselinePublication } from './baseline-publication.ts';
import type { OrdinaryBaselineChange } from './baseline-record.ts';

const first: OrdinaryBaselineChange = { kind: 'create', baseline: storedBaseline };
const second: OrdinaryBaselineChange = { kind: 'create', baseline: { ...storedBaseline, adapter: 'second' } };

export const testNode = suite('ordinary baseline batch publication', [
    test(
        'retains completed writes and the original error after a later write fails',
        async function (scope: TestScope) {
            const store = memoryOrdinaryBaselines([]);
            const error = new Error('Storage became unavailable.');
            const publish = createBaselinePublication({
                validate: store.validate,
                async acquire() {
                    return async function release() {
                        return undefined;
                    };
                },
                async apply(change) {
                    if (change.baseline.adapter === 'second') {
                        throw error;
                    }
                    await store.apply(change);
                }
            });
            scope.assert.deepEqual(await publish([ first, second ]), {
                outcome: { kind: 'failed', writtenChanges: [ first ] },
                errors: [ error ]
            });
            const records = await store.list();
            scope.assert.deepEqual(
                records.map(function baseline(entry) {
                    return entry.baseline;
                }),
                [ storedBaseline ]
            );
            return scope.assert.collect();
        }
    ),
    test('validates the entire batch while locked and releases after writing', async function (scope: TestScope) {
        const operations: string[] = [];
        const publish = createBaselinePublication({
            async acquire() {
                operations.push('lock');
                return async function release() {
                    operations.push('release');
                };
            },
            async validate(changes) {
                operations.push(`validate ${changes.length}`);
            },
            async apply(change) {
                operations.push(change.baseline.adapter);
            }
        });
        scope.assert.deepEqual(await publish([ first, second ]), {
            outcome: { kind: 'written', changes: [ first, second ] },
            errors: []
        });
        scope.assert.deepEqual(operations, [ 'lock', 'validate 2', 'output', 'second', 'release' ]);
        return scope.assert.collect();
    }),
    test('blocks the whole batch when validation fails', async function (scope: TestScope) {
        const error = new Error('Baseline changed during execution.');
        const operations: string[] = [];
        const publish = createBaselinePublication({
            async acquire() {
                return async function release() {
                    operations.push('release');
                };
            },
            async validate() {
                throw error;
            },
            async apply() {
                operations.push('write');
            }
        });
        scope.assert.deepEqual(await publish([ first, second ]), { outcome: { kind: 'blocked' }, errors: [ error ] });
        scope.assert.deepEqual(operations, [ 'release' ]);
        return scope.assert.collect();
    }),
    test('preserves written changes when releasing the lock fails', async function (scope: TestScope) {
        const error = new Error('Release failed.');
        const store = memoryOrdinaryBaselines([]);
        const publish = createBaselinePublication({
            validate: store.validate,
            apply: store.apply,
            async acquire() {
                return async function release() {
                    throw error;
                };
            }
        });
        scope.assert.deepEqual(await publish([ first ]), {
            outcome: { kind: 'failed', writtenChanges: [ first ] },
            errors: [ error ]
        });
        const records = await store.list();
        scope.assert.equal(records.length, 1);
        return scope.assert.collect();
    }),
    test('retains validation and release errors together', async function (scope: TestScope) {
        const validation = new Error('Invalid batch.');
        const release = new Error('Release failed.');
        const publish = createBaselinePublication({
            async acquire() {
                return async function releaseLock() {
                    throw release;
                };
            },
            async validate() {
                throw validation;
            },
            async apply() {
                throw new Error('Blocked batches must not be written.');
            }
        });
        scope.assert.deepEqual(await publish([ first ]), {
            outcome: { kind: 'blocked' },
            errors: [ validation, release ]
        });
        return scope.assert.collect();
    }),
    test('propagates lock acquisition errors without attempting writes', async function (scope: TestScope) {
        const error = new Error('Lock unavailable.');
        const publish = createBaselinePublication({
            async acquire() {
                throw error;
            },
            async validate() {
                throw new Error('No lock acquired.');
            },
            async apply() {
                throw new Error('No lock acquired.');
            }
        });
        await scope.assert.rejects(async function acquireUnavailableLock() {
            await publish([ first ]);
        }, { message: error.message });
        return scope.assert.collect();
    }),
    test('does not acquire a lock for an empty batch', async function (scope: TestScope) {
        const publish = createBaselinePublication({
            async acquire() {
                throw new Error('Empty batches do not need a lock.');
            },
            async validate() {
                throw new Error('Empty batches do not need validation.');
            },
            async apply() {
                throw new Error('Empty batches have no writes.');
            }
        });
        scope.assert.deepEqual(await publish([]), { outcome: { kind: 'written', changes: [] }, errors: [] });
        return scope.assert.collect();
    })
]);
