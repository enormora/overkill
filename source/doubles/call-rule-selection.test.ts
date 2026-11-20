import { type TestNode, suite, test } from '@overkill-dev/test';

import { rule } from './double-rule.ts';
import { testDouble } from './test-double.ts';

type Lookup = (key: string) => string;
type Load = (key: string) => Promise<string>;
export const testNode: TestNode = suite('call argument rule selection', [
    test('invokes the selected answer with the original arguments', function (scope) {
        const lookup = testDouble<Lookup>({
            rules: [
                rule.when('selected').calls(function (key) {
                    return `answer:${key}`;
                })
            ],
            fallback: rule.returns<Lookup>('fallback')
        });
        scope.assert.equal(lookup('selected'), 'answer:selected');
        scope.assert.equal(lookup('other'), 'fallback');
        return scope.assert.collect();
    }),
    test('throws only for the matching argument rule', function (scope) {
        const error = new Error('selected failure');
        const lookup = testDouble<Lookup>({
            rules: [ rule.when('selected').throws(error) ],
            fallback: rule.returns<Lookup>('fallback')
        });
        scope.assert.throws(function () {
            lookup('selected');
        }, { exact: error });
        scope.assert.equal(lookup('other'), 'fallback');
        return scope.assert.collect();
    }),
    test('resolves the matching asynchronous argument rule', async function (scope) {
        const load = testDouble<Load>({
            rules: [ rule.when('selected').resolves<Load>('answer') ],
            fallback: rule.resolves<Load>('fallback')
        });
        scope.assert.equal(await load('selected'), 'answer');
        scope.assert.equal(await load('other'), 'fallback');
        return scope.assert.collect();
    }),
    test('rejects only the matching asynchronous argument rule', async function (scope) {
        const error = new Error('selected failure');
        const load = testDouble<Load>({
            rules: [ rule.when('selected').rejects<Load>(error) ],
            fallback: rule.resolves<Load>('fallback')
        });
        await scope.assert.rejects(async function () {
            await load('selected');
        }, { exact: error });
        scope.assert.equal(await load('other'), 'fallback');
        return scope.assert.collect();
    })
]);
