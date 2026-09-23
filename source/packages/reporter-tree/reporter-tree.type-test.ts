import { describe, expect, test } from 'tstyche';
import type { DefinedReporter, FinalResultReporter } from '../engine/engine.entry-point.ts';
import { createTreeReporter } from './reporter-tree.entry-point.ts';

describe('createTreeReporter', function () {
    test('returns the public final-result reporter contract', function () {
        expect(createTreeReporter()).type.toBe<DefinedReporter<FinalResultReporter>>();
        expect(createTreeReporter({ showPassing: false, verbose: true })).type.toBe<
            DefinedReporter<FinalResultReporter>
        >();
    });
});
