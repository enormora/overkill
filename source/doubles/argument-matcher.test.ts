import { suite, test } from '@overkill-dev/test';
import { P } from 'ts-pattern';
import { subjectAssertion } from '../test-support/assertion-reference-boundary.ts';
import { doubleUsage as subjectUsage, matches, rule, testDouble } from '../packages/doubles/doubles.entry-point.ts';

export const testNode = suite('typed argument patterns', [
    test('wrapped rules require exact arity while raw rules preserve prefixes', function (scope) {
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
    }),
    test('nested patterns support unions optional properties arrays and instances', function (scope) {
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
    }),
    test('constructor patterns preserve original history', function (scope) {
        const instance = { id: 'client' };
        const Client = testDouble<new (url: string) => typeof instance>({
            rules: [ rule.whenConstructedWith(matches(P.string)).constructs(instance) ]
        });
        scope.assert.equal(new Client('url'), instance);
        scope.assert(subjectAssertion(subjectUsage.constructedOnceWith), Client, [ matches(P.string) ]);
        scope.assert.equal(Client.firstConstruction?.arguments[0], 'url');
        return scope.assert.collect();
    }),
    test('mixed assertions preserve partial exact and prefix semantics', function (scope) {
        const save = testDouble.returns('saved');
        save('id', { id: 1, extra: true });
        scope.assert(subjectAssertion(subjectUsage.calledWith), save, [ matches(P.string), { id: 1 } ]);
        scope.assert(subjectAssertion(subjectUsage.calledWithExactly), save, [ matches(P.string), {
            id: 1,
            extra: true
        } ]);
        scope.assert(subjectAssertion(subjectUsage.calledWithPrefix), save, [ matches(P.string) ]);
        scope.assert(subjectAssertion(subjectUsage.lastCalledWith), save, [ matches(P.string), { id: 1 } ]);
        scope.assert(subjectAssertion(subjectUsage.nthCallWith), save, 0, [ matches(P.string), { id: 1 } ]);
        scope.assert(subjectAssertion(subjectUsage.interactedOnceWith), save, [ matches(P.string), { id: 1 } ]);
        return scope.assert.collect();
    }),
    test('predicate errors retain identity and bypass fallback', function (scope) {
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
    }),
    test('pattern assertions evaluate each examined predicate once', function (scope) {
        let count = 0;
        const pattern = matches(P.when(function counted(value: unknown) {
            count += 1;
            return typeof value === 'string';
        }));
        const save = testDouble.returns('saved');
        save('id');
        save('another');
        scope.assert(subjectAssertion(subjectUsage.calledWith), save, [ pattern ]);
        scope.assert.equal(count, 1);
        return scope.assert.collect();
    })
]);
