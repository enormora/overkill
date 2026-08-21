import { describe, expect, test } from 'tstyche';
import type { DefinedOutputRenderer } from '../engine/engine.entry-point.ts';
import type { createGithubActionsOutputRenderer } from './output-renderer-github-actions.entry-point.ts';

describe('@overkill-dev/output-renderer-github-actions', function () {
    test('returns the public output renderer contract', function () {
        expect<typeof createGithubActionsOutputRenderer>().type.toBe<() => DefinedOutputRenderer>();
    });
});
