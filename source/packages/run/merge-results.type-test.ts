import type { IsEqual } from 'type-fest';
import { suite, test } from '@overkill-dev/test-type-authoring';
import { assignableTo, sameType } from '@overkill-dev/type-test';
import type { MergeResultsCommand, MergeResultsInput, MergedRunRecord, mergeResults } from './run.entry-point.ts';

export const testNode = suite('merge results', [
    test('requires nonempty inputs and returns a merged record', function (typeScope) {
        typeScope.assert(
            sameType<IsEqual<typeof mergeResults, (command: MergeResultsCommand) => Promise<MergedRunRecord>>, true>()
        );
        typeScope.assert(sameType<ReturnType<typeof mergeResults>, Promise<MergedRunRecord>>());
        typeScope.assert(sameType<MergeResultsCommand['inputs'][0], MergeResultsInput>());
        typeScope.assert(assignableTo<{ readonly kind: 'path'; readonly path: string; }, MergeResultsInput>());
        typeScope.assert(sameType<MergedRunRecord['kind'], 'merged'>());
        return typeScope.assert.collect();
    })
]);
