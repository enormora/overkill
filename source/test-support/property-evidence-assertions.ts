import {
    defineCompositeAssertion,
    type CompositeAssertionReturn,
    type CompositeCheckBuilder
} from '@overkill-dev/test/assert';
import type { RunResult } from '../packages/engine/engine.entry-point.ts';

export function checkedInCorpusChecks(
    check: CompositeCheckBuilder<'assert'>,
    result: RunResult
): CompositeAssertionReturn<'assert'> {
    const evidence = result.perTest[0]?.property?.invocations[0];
    if (evidence === undefined) {
        return check.defined(evidence);
    }
    if (evidence.summary === null) {
        return check.notNull(evidence.summary);
    }
    return check.greaterThan(evidence.summary.accounting.phases['checked-in-corpus'].executed, 0);
}

export const capturedPropertyFailure = defineCompositeAssertion({
    name: 'captures a property failure without runner errors',
    assert(check, result: RunResult) {
        return check.group([ check.equal(result.summary.failed, 1), check.deepEqual(result.runnerErrors, []) ]);
    }
});
