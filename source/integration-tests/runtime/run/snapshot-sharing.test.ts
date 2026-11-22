import path from 'node:path';
import { suite, test } from '@overkill-dev/test';

import type { evaluateSnapshot } from '../../../baselines/snapshot-context.ts';
import { recordSnapshotAttempt, snapshotWire } from '../../../test-support/snapshot-fixture.ts';
import { markSnapshotExecutionError, isSnapshotExecutionError } from '../../../run/snapshot-error.ts';

type ContextCopy = { readonly evaluateSnapshot: typeof evaluateSnapshot; };
type ErrorCopy = {
    readonly markSnapshotExecutionError: typeof markSnapshotExecutionError;
    readonly isSnapshotExecutionError: typeof isSnapshotExecutionError;
};

function isContextCopy(value: unknown): value is ContextCopy {
    return typeof value === 'object' && value !== null && typeof Reflect.get(value, 'evaluateSnapshot') === 'function';
}

function isErrorCopy(value: unknown): value is ErrorCopy {
    return typeof value === 'object' && value !== null &&
        typeof Reflect.get(value, 'markSnapshotExecutionError') === 'function' &&
        typeof Reflect.get(value, 'isSnapshotExecutionError') === 'function';
}

async function copyModule(sourcePath: string): Promise<unknown> {
    const url = new URL(`${sourcePath}${path.extname(import.meta.url)}?snapshot-copy`, import.meta.url);
    return await import(url.href);
}

export const testNode = suite('snapshot package context sharing', [
    test('shares active attempts with an independently loaded assertion module', async function (scope) {
        const copy = await copyModule('../../../baselines/snapshot-context');
        if (!isContextCopy(copy)) {
            throw new TypeError('Expected snapshot context exports.');
        }
        const input = { kind: 'text', name: 'response', actual: 'hello' } as const;
        const captured = await recordSnapshotAttempt(
            { ...snapshotWire, mode: 'update' },
            copy.evaluateSnapshot.bind(null, input)
        );
        scope.assert.deepEqual(captured.value, { kind: 'accepted' });
        scope.assert.equal(captured.artifacts.length, 1);
        await scope.assert.rejects(copy.evaluateSnapshot.bind(null, input), {
            message: 'Snapshots require an integration profile with baselines.snapshots enabled.'
        });
        return scope.assert.collect();
    }),
    test('recognizes infrastructure errors marked by either module copy', async function (scope) {
        const copy = await copyModule('../../../run/snapshot-error');
        if (!isErrorCopy(copy)) {
            throw new TypeError('Expected snapshot error exports.');
        }
        const cause = new TypeError('invalid snapshot');
        const marked = copy.markSnapshotExecutionError(cause);
        scope.assert.equal(marked, cause);
        scope.assert.true(isSnapshotExecutionError(marked));
        scope.assert.true(copy.isSnapshotExecutionError(markSnapshotExecutionError(new Error('original'))));
        return scope.assert.collect();
    })
]);
