import type { IsEqual } from 'type-fest';
import { suite, test } from '../../../tools/type-tests/authoring.entry-point.ts';
import { sameType } from '../../../tools/type-tests/relations.entry-point.ts';
import type { IsAssignable } from '../../test-support/type-relations.ts';
import type { MergeResultsCommand, MergeResultsInput, MergedRunRecord, mergeResults } from './run.entry-point.ts';

export const testNode = suite('merge results', [
    test('requires nonempty inputs and returns a merged record', function (typeScope) {
        typeScope.assert(
            sameType<IsEqual<typeof mergeResults, (command: MergeResultsCommand) => Promise<MergedRunRecord>>, true>()
        );
        typeScope.assert(sameType<IsEqual<ReturnType<typeof mergeResults>, Promise<MergedRunRecord>>, true>());
        typeScope.assert(sameType<IsEqual<MergeResultsCommand['inputs'][0], MergeResultsInput>, true>());
        typeScope.assert(
            sameType<IsAssignable<{ readonly kind: 'path'; readonly path: string; }, MergeResultsInput>, true>()
        );
        typeScope.assert(sameType<MergedRunRecord['kind'], 'merged'>());
        return typeScope.assert.collect();
    })
]);
