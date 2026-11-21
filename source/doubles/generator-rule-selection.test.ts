import { suite, test } from '@overkill-dev/test';

import { rule } from './double-rule.ts';
import { testDouble } from './test-double.ts';

type LoadValues = (prefix: string) => Generator<string, string, unknown>;
type LoadAsyncValues = (prefix: string) => AsyncGenerator<string, string, unknown>;
export const testNode = suite('yielding double argument rules', [
    test('selects synchronous yielded values by invocation arguments', function (scope) {
        const load = testDouble<LoadValues>({
            rules: [ rule.when('selected').yields<LoadValues>([ 'chosen' ], 'complete') ],
            fallback: rule.yields<LoadValues>([ 'fallback' ], 'missing')
        });
        const selected = load('selected');
        const fallback = load('other');
        scope.assert.deepEqual([ selected.next(), selected.next(), fallback.next(), fallback.next() ], [
            { done: false, value: 'chosen' },
            { done: true, value: 'complete' },
            { done: false, value: 'fallback' },
            { done: true, value: 'missing' }
        ]);
        scope.assert.equal(load.callCount, 2);
        return scope.assert.collect();
    }),
    test('delegates synchronous argument rules to the original invocation', function (scope) {
        const load = testDouble<LoadValues>({
            rules: [
                rule.when('selected').yieldsFrom<LoadValues>(function* (prefix) {
                    yield `${prefix}:value`;
                    return `${prefix}:complete`;
                })
            ],
            fallback: rule.yields<LoadValues>([], 'missing')
        });
        const selected = load('selected');
        const fallback = load('other');
        scope.assert.deepEqual([ selected.next(), selected.next(), fallback.next() ], [
            { done: false, value: 'selected:value' },
            { done: true, value: 'selected:complete' },
            { done: true, value: 'missing' }
        ]);
        return scope.assert.collect();
    }),
    test('selects asynchronous yielded values by invocation arguments', async function (scope) {
        const load = testDouble<LoadAsyncValues>({
            rules: [ rule.when('selected').yieldsAsync<LoadAsyncValues>([ 'chosen' ], 'complete') ],
            fallback: rule.yieldsAsync<LoadAsyncValues>([], 'missing')
        });
        const selected = load('selected');
        const fallback = load('other');
        scope.assert.deepEqual([ await selected.next(), await selected.next(), await fallback.next() ], [
            { done: false, value: 'chosen' },
            { done: true, value: 'complete' },
            { done: true, value: 'missing' }
        ]);
        return scope.assert.collect();
    }),
    test(
        'delegates asynchronous argument rules without losing the generator return value',
        async function (scope) {
            const load = testDouble<LoadAsyncValues>({
                rules: [
                    rule
                        .when('selected')
                        .yieldsAsyncFrom<LoadAsyncValues>(async function* (prefix) {
                            yield `${prefix}:value`;
                            return `${prefix}:complete`;
                        })
                ],
                fallback: rule.yieldsAsync<LoadAsyncValues>([], 'missing')
            });
            const selected = load('selected');
            const fallback = load('other');
            scope.assert.deepEqual([ await selected.next(), await selected.next(), await fallback.next() ], [
                { done: false, value: 'selected:value' },
                { done: true, value: 'selected:complete' },
                { done: true, value: 'missing' }
            ]);
            return scope.assert.collect();
        }
    )
]);
