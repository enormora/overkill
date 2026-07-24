import { describe, expect, test } from 'tstyche';
import type { RealTimeReporter } from '../engine/engine.entry-point.ts';
import { createDotReporter } from './reporter-dot.entry-point.ts';

describe('createDotReporter', function () {
    test('returns the public real-time reporter contract', function () {
        expect(createDotReporter()).type.toBe<RealTimeReporter>();
    });
});
