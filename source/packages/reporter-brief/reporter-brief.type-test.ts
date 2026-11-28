import type { IsEqual } from 'type-fest';
import { suite, test } from '../test/test.entry-point.ts';
import { sameType } from '../type-test/type-test.entry-point.ts';
import type { DefinedReporter, FinalResultReporter, RealTimeReporter } from '../engine/engine.entry-point.ts';
import type {
    BriefReporterSinks,
    createBriefFinalResultReporter,
    createBriefReporter
} from './reporter-brief.entry-point.ts';

export const testNode = suite('Brief run reporter options', [
    test('returns the public reporter lifecycle contracts', function (scope) {
        scope.assert(
            sameType<
                IsEqual<
                    typeof createBriefFinalResultReporter,
                    () => DefinedReporter<FinalResultReporter<BriefReporterSinks>>
                >,
                true
            >()
        );
        scope.assert(
            sameType<
                IsEqual<typeof createBriefReporter, () => DefinedReporter<RealTimeReporter<BriefReporterSinks>>>,
                true
            >()
        );
        return scope.assert.collect();
    })
]);
