import type { IsEqual } from 'type-fest';
import { suite, test } from '@overkill-dev/test';
import { sameType } from '@overkill-dev/type-test';
import type { IsAssignable } from '../../test-support/type-relations.ts';
import type { MergeResultsCommand, MergeResultsInput, MergedRunRecord, mergeResults } from './run.entry-point.ts';

export const testNode = suite('Merging results from multiple runs', [
    test('requires nonempty inputs and returns a merged record', function (scope) {
        scope.assert(
            sameType<IsEqual<typeof mergeResults, (command: MergeResultsCommand) => Promise<MergedRunRecord>>, true>()
        );
        scope.assert(sameType<IsEqual<ReturnType<typeof mergeResults>, Promise<MergedRunRecord>>, true>());
        scope.assert(sameType<IsEqual<MergeResultsCommand['inputs'][0], MergeResultsInput>, true>());
        scope.assert(
            sameType<IsAssignable<{ readonly kind: 'path'; readonly path: string; }, MergeResultsInput>, true>()
        );
        scope.assert(sameType<MergedRunRecord['kind'], 'merged'>());
        return scope.assert.collect();
    })
]);
