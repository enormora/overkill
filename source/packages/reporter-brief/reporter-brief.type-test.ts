import { describe, expect, test } from 'tstyche';
import type { RealTimeReporter } from '../engine/engine.entry-point.ts';
import type { createBriefReporter } from './reporter-brief.entry-point.ts';

describe('@overkill-dev/reporter-brief', function () {
    test('returns the public real-time reporter contract', function () {
        expect<typeof createBriefReporter>().type.toBe<() => RealTimeReporter>();
    });
});
