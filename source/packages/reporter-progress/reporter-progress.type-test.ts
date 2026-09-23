import { describe, expect, test } from 'tstyche';
import type { DefinedReporter, RealTimeReporter } from '../engine/engine.entry-point.ts';
import { createProgressReporter } from './reporter-progress.entry-point.ts';

describe('createProgressReporter', function () {
    test('returns the public real-time reporter contract', function () {
        expect(createProgressReporter()).type.toBe<DefinedReporter<RealTimeReporter>>();
        expect(createProgressReporter({ showPassing: false, verbose: true })).type.toBe<
            DefinedReporter<RealTimeReporter>
        >();
    });
});
