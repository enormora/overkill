import { describe, expect, test } from 'tstyche';
import type { DefinedReporter, FinalResultReporter, RealTimeReporter } from '../engine/engine.entry-point.ts';
import {
    createLineProgressReporter,
    createLineReporter,
    createLineTreeReporter
} from './reporter-line.entry-point.ts';

describe('createLineReporter', function () {
    test('returns the public real-time reporter contract', function () {
        expect(createLineReporter()).type.toBe<DefinedReporter<RealTimeReporter>>();
        expect(createLineReporter({ verbose: true })).type.toBe<DefinedReporter<RealTimeReporter>>();
    });

    test('exposes progress and tree presentation variants', function () {
        expect(createLineProgressReporter()).type.toBe<DefinedReporter<RealTimeReporter>>();
        expect(createLineProgressReporter({ showPassing: false, verbose: true })).type.toBe<
            DefinedReporter<RealTimeReporter>
        >();
        expect(createLineTreeReporter()).type.toBe<DefinedReporter<FinalResultReporter>>();
        expect(createLineTreeReporter({ showPassing: false, verbose: true })).type.toBe<
            DefinedReporter<FinalResultReporter>
        >();
    });
});
