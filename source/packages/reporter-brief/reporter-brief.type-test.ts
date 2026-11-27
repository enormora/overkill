import type { IsEqual } from 'type-fest';
import { suite, test } from '../../../tools/type-tests/authoring.entry-point.ts';
import { sameType } from '../../../tools/type-tests/relations.entry-point.ts';
import type { DefinedReporter, FinalResultReporter, RealTimeReporter } from '../engine/engine.entry-point.ts';
import type {
    BriefReporterSinks,
    createBriefFinalResultReporter,
    createBriefReporter
} from './reporter-brief.entry-point.ts';

export const testNode = suite('@overkill-dev/reporter-brief', [
    test('returns the public reporter lifecycle contracts', function (typeScope) {
        typeScope.assert(
            sameType<
                IsEqual<
                    typeof createBriefFinalResultReporter,
                    () => DefinedReporter<FinalResultReporter<BriefReporterSinks>>
                >,
                true
            >()
        );
        typeScope.assert(
            sameType<
                IsEqual<typeof createBriefReporter, () => DefinedReporter<RealTimeReporter<BriefReporterSinks>>>,
                true
            >()
        );
        return typeScope.assert.collect();
    })
]);
