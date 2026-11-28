import type { IsEqual } from 'type-fest';
import { suite, test } from '../test/test.entry-point.ts';
import { sameType } from '../type-test/type-test.entry-point.ts';
import type { DefinedOutputRenderer } from '../engine/engine.entry-point.ts';
import type { createGithubActionsOutputRenderer } from './output-renderer-github-actions.entry-point.ts';

export const testNode = suite('GitHub Actions run output', [
    test('returns the public output renderer contract', function (scope) {
        scope.assert(
            sameType<IsEqual<typeof createGithubActionsOutputRenderer, () => DefinedOutputRenderer>, true>()
        );
        return scope.assert.collect();
    })
]);
