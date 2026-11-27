import { suite, test } from '@overkill-dev/test-type-authoring';
import { sameType } from '@overkill-dev/type-test';
import type { DefinedOutputRenderer } from '../engine/engine.entry-point.ts';
import type { createGithubActionsOutputRenderer } from './output-renderer-github-actions.entry-point.ts';

export const testNode = suite('@overkill-dev/output-renderer-github-actions', [
    test('returns the public output renderer contract', function (typeScope) {
        typeScope.assert(sameType<typeof createGithubActionsOutputRenderer, () => DefinedOutputRenderer>());
        return typeScope.assert.collect();
    })
]);
