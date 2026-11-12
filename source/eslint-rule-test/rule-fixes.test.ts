import { suite, test } from '../packages/test/test.entry-point.ts';
import { applyRuleEdits } from './rule-fixes.ts';

const byteOrderMarkCodePoint = 65_279;
const byteOrderMark = String.fromCodePoint(byteOrderMarkCodePoint);

export const testNode = suite('ESLint fix application', [
    test('preserves byte order marks and applies source-relative ranges', function (scope) {
        scope.assert.equal(
            applyRuleEdits(`${byteOrderMark}first`, [ { range: [ 0, 5 ], text: 'second' } ]),
            `${byteOrderMark}second`
        );
        scope.assert.equal(applyRuleEdits(`${byteOrderMark}first`, [ { range: [ -1, 0 ], text: '' } ]), 'first');
        return scope.assert.collect();
    }),
    test('keeps the first edit when ranges overlap or touch', function (scope) {
        scope.assert.equal(
            applyRuleEdits('abcd', [ { range: [ 0, 2 ], text: 'x' }, { range: [ 1, 3 ], text: 'y' } ]),
            'xcd'
        );
        scope.assert.equal(
            applyRuleEdits('abcd', [ { range: [ 0, 2 ], text: 'x' }, { range: [ 2, 4 ], text: 'y' } ]),
            'xcd'
        );
        return scope.assert.collect();
    })
]);
