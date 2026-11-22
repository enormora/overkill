import { suite, test } from '@overkill-dev/test';

import { benchmarkBudgetFixture } from '../test-support/benchmark-html-fixture.ts';
import { createBenchmarkHtmlReport } from './benchmark-html-model.ts';
import { renderBenchmarkHtml } from './benchmark-html-document.ts';
import { difference, percentDifference } from './benchmark-deltas.ts';

function budgetHtml(): string {
    const { result, measured, benchmark, budget } = benchmarkBudgetFixture('budget deltas');
    return renderBenchmarkHtml(
        createBenchmarkHtmlReport({
            result: {
                ...result,
                perTest: [ {
                    ...measured,
                    benchmark: {
                        ...benchmark,
                        budgets: [ { ...budget, estimate: 5, minimum: 2, maximum: 10 } ]
                    }
                } ]
            },
            context: { id: null, startedAt: null, facts: null }
        }),
        ''
    );
}
export const testNode = suite('benchmark budget deltas', [
    test('renders both bound deltas beside the recorded decision', function (scope) {
        const html = budgetHtml();
        scope.assert.includes(html, '<td>2</td><td>10</td><td>3</td><td>150</td><td>-5</td><td>-50</td>');
        scope.assert.includes(html, 'Delta from minimum %');
        scope.assert.includes(html, 'Delta from maximum %');
        return scope.assert.collect();
    }),
    test('keeps signed deltas and unavailable percentages explicit', function (scope) {
        scope.assert.equal(difference(5, 10), -5);
        scope.assert.equal(percentDifference(5, 10), -50);
        scope.assert.equal(percentDifference(-5, -10), 50);
        scope.assert.equal(difference(5, 0), 5);
        scope.assert.equal(percentDifference(5, 0), null);
        scope.assert.equal(difference(null, 10), null);
        scope.assert.equal(percentDifference(5, null), null);
        scope.assert.equal(difference(Number.MAX_VALUE, -Number.MAX_VALUE), null);
        return scope.assert.collect();
    })
]);
