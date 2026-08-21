import { describe, expect, test } from 'tstyche';
import type { DefinedReporter, RealTimeReporter } from '../engine/engine.entry-point.ts';
import { createLineReporter } from './reporter-line.entry-point.ts';

describe('createLineReporter', function () {
    test('returns the public real-time reporter contract', function () {
        expect(createLineReporter()).type.toBe<DefinedReporter<RealTimeReporter>>();
    });
});
