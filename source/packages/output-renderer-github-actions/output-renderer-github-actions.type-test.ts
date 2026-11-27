import type { IsEqual } from 'type-fest';
import { suite, test } from '../../../tools/type-tests/authoring.entry-point.ts';
import { sameType } from '../../../tools/type-tests/relations.entry-point.ts';
import type { DefinedOutputRenderer } from '../engine/engine.entry-point.ts';
import type { createGithubActionsOutputRenderer } from './output-renderer-github-actions.entry-point.ts';

export const testNode = suite('@overkill-dev/output-renderer-github-actions', [
    test('returns the public output renderer contract', function (typeScope) {
        typeScope.assert(
            sameType<IsEqual<typeof createGithubActionsOutputRenderer, () => DefinedOutputRenderer>, true>()
        );
        return typeScope.assert.collect();
    })
]);
