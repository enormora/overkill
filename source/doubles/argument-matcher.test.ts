import { runIfMain } from '#test-runner';
import { P } from 'ts-pattern';
import { createSuite, createTestCase, type TestScope } from '../packages/engine/engine.entry-point.ts';
import { doubleUsage, matches, rule, testDouble } from '../packages/doubles/doubles.entry-point.ts';

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'typed argument patterns',
    annotations: {},
    controls: {},
    children: [
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'wrapped rules require exact arity while raw rules preserve prefixes',
            annotations: {},
            controls: {},
            body(scope: TestScope) {
                const wrapped = testDouble<(id: string, extra?: number) => string>({
                    rules: [ rule.when(matches(P.string)).returns('matched') ],
                    fallback: rule.returns('fallback')
                });
                const raw = testDouble<(id: string, extra?: number) => string>({
                    rules: [ rule.when('id').returns('matched') ]
                });
                scope.assert.equal(wrapped('id'), 'matched');
                scope.assert.equal(wrapped('id', 1), 'fallback');
                scope.assert.equal(raw('id', 1), 'matched');
                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'nested patterns support unions optional properties arrays and instances',
            annotations: {},
            controls: {},
            body(scope: TestScope) {
                const pattern = matches({
                    id: P.union('a', 'b'),
                    tags: P.array(P.string),
                    optional: P.optional(P.number),
                    date: P.instanceOf(Date)
                });
                const load = testDouble({ rules: [ rule.when(pattern).returns(true) ], fallback: rule.returns(false) });
                scope.assert.true(load({ id: 'a', tags: [ 'x' ], date: new Date(0) }));
                scope.assert.false(load({ id: 'c', tags: [ 'x' ], date: new Date(0) }));
                scope.assert.true(Object.isFrozen(pattern));
                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'constructor patterns preserve original history',
            annotations: {},
            controls: {},
            body(scope: TestScope) {
                const instance = { id: 'client' };
                const Client = testDouble<new (url: string) => typeof instance>({
                    rules: [ rule.whenConstructedWith(matches(P.string)).constructs(instance) ]
                });
                scope.assert.equal(new Client('url'), instance);
                scope.assert(doubleUsage.constructedOnceWith, Client, [ matches(P.string) ]);
                scope.assert.equal(Client.firstConstruction?.arguments[0], 'url');
                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'mixed assertions preserve partial exact and prefix semantics',
            annotations: {},
            controls: {},
            body(scope: TestScope) {
                const save = testDouble.returns('saved');
                save('id', { id: 1, extra: true });
                scope.assert(doubleUsage.calledWith, save, [ matches(P.string), { id: 1 } ]);
                scope.assert(doubleUsage.calledWithExactly, save, [ matches(P.string), { id: 1, extra: true } ]);
                scope.assert(doubleUsage.calledWithPrefix, save, [ matches(P.string) ]);
                scope.assert(doubleUsage.lastCalledWith, save, [ matches(P.string), { id: 1 } ]);
                scope.assert(doubleUsage.nthCallWith, save, 0, [ matches(P.string), { id: 1 } ]);
                scope.assert(doubleUsage.interactedOnceWith, save, [ matches(P.string), { id: 1 } ]);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'predicate errors retain identity and bypass fallback',
            annotations: {},
            controls: {},
            body(scope: TestScope) {
                const error = new Error('predicate failed');
                const load = testDouble({
                    rules: [
                        rule
                            .when(matches(P.when(function rejectInput() {
                                throw error;
                            })))
                            .returns(true)
                    ],
                    fallback: rule.returns(false)
                });
                scope.assert.throws(function invoke() {
                    load('id');
                }, { exact: error });
                scope.assert.equal(load.lastResult?.status, 'threw');
                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'pattern assertions evaluate each examined predicate once',
            annotations: {},
            controls: {},
            body(scope: TestScope) {
                let count = 0;
                const pattern = matches(P.when(function counted(value: unknown) {
                    count += 1;
                    return typeof value === 'string';
                }));
                const save = testDouble.returns('saved');
                save('id');
                save('another');
                scope.assert(doubleUsage.calledWith, save, [ pattern ]);
                scope.assert.equal(count, 1);
                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testNode);
