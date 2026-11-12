import { describe, expect, test } from 'tstyche';
import type { MergeResultsCommand, MergeResultsInput, MergedRunRecord, mergeResults } from './run.entry-point.ts';

describe('merge results', function () {
    test('requires nonempty inputs and returns a merged record', function () {
        expect<typeof mergeResults>().type.toBe<(command: MergeResultsCommand) => Promise<MergedRunRecord>>();
        expect<ReturnType<typeof mergeResults>>().type.toBe<Promise<MergedRunRecord>>();
        expect<MergeResultsCommand['inputs'][0]>().type.toBe<MergeResultsInput>();
        expect<{ readonly kind: 'path'; readonly path: string; }>().type.toBeAssignableTo<MergeResultsInput>();
        expect<MergedRunRecord['kind']>().type.toBe<'merged'>();
    });
});
