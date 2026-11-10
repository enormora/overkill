import { describe, expect, test } from 'tstyche';
import type { DefinedReporter, FinalResultReporter, RealTimeReporter } from '../engine/engine.entry-point.ts';
import type {
    BriefReporterSinks,
    createBriefFinalResultReporter,
    createBriefReporter
} from './reporter-brief.entry-point.ts';

describe('@overkill-dev/reporter-brief', function () {
    test('returns the public reporter lifecycle contracts', function () {
        expect<typeof createBriefFinalResultReporter>().type.toBe<
            () => DefinedReporter<FinalResultReporter<BriefReporterSinks>>
        >();
        expect<typeof createBriefReporter>().type.toBe<() => DefinedReporter<RealTimeReporter<BriefReporterSinks>>>();
    });
});
