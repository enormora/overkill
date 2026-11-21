import { suite, test } from '@overkill-dev/test';

import { mergedRecordSession } from '../test-support/merged-record-session.ts';
import { runMergedRecordSession } from './merged-record-session.ts';

export const testNode = suite('merged record persistence and delivery', [
    test(
        'persists completion, disposes reporters and releases the run before maintenance',
        async function (scope) {
            const fixture = await mergedRecordSession('none');
            const result = await runMergedRecordSession(fixture.command, fixture.storage, fixture.runtime);
            scope.assert.equal(result.record.status, 'completed');
            scope.assert.deepEqual(result.diagnostics, [ 'maintenance diagnostic' ]);
            scope.assert.deepEqual(Array.from(fixture.events), [
                'begin',
                'write',
                'create-delivery',
                'report',
                'dispose',
                'write',
                'release',
                'maintain'
            ]);
            scope.assert.includes(fixture.content() ?? '', '"status":"completed"');
            return scope.assert.collect();
        }
    ),
    test('persists interruption and releases the run after reporter failure', async function (scope) {
        const fixture = await mergedRecordSession('delivery');
        await scope.assert.rejects(async function () {
            return await runMergedRecordSession(fixture.command, fixture.storage, fixture.runtime);
        }, { exact: fixture.failure });
        scope.assert.equal(fixture.storage.current().status, 'interrupted');
        scope.assert.equal(
            fixture.storage.current().result.runnerErrors[0]?.message,
            'Merged result delivery interrupted.'
        );
        scope.assert.deepEqual(Array.from(fixture.events), [
            'begin',
            'write',
            'create-delivery',
            'report',
            'dispose',
            'write',
            'release'
        ]);
        return scope.assert.collect();
    }),
    test('releases the run after reporter disposal fails', async function (scope) {
        const fixture = await mergedRecordSession('disposal');
        await scope.assert.rejects(async function () {
            return await runMergedRecordSession(fixture.command, fixture.storage, fixture.runtime);
        }, { exact: fixture.failure });
        scope.assert.equal(fixture.storage.current().status, 'interrupted');
        scope.assert.equal(fixture.events.at(-1), 'release');
        return scope.assert.collect();
    }),
    test('retains persistence failures when both writes fail', async function (scope) {
        const fixture = await mergedRecordSession('write');
        await fixture.storage.persist('completed');
        scope.assert.equal(fixture.storage.current().result.status, 'failed');
        scope.assert.equal(fixture.storage.current().result.runnerErrors.length, 1);
        scope.assert.equal(fixture.content(), null);
        scope.assert.deepEqual(Array.from(fixture.events), [ 'begin', 'write', 'write' ]);
        await fixture.storage.release();
        return scope.assert.collect();
    }),
    test('rewrites the detailed record with compact history failures', async function (scope) {
        const fixture = await mergedRecordSession('history');
        await fixture.storage.persist('started');
        scope.assert.equal(fixture.storage.current().result.status, 'failed');
        scope.assert.includes(fixture.content() ?? '', 'Failed to');
        scope.assert.deepEqual(Array.from(fixture.events), [ 'begin', 'write', 'write' ]);
        await fixture.storage.release();
        return scope.assert.collect();
    }),
    test('leaves a successful result unchanged when no errors are retained', async function (scope) {
        const fixture = await mergedRecordSession('none');
        const before = fixture.storage.current();
        fixture.storage.retainErrors([]);
        scope.assert.equal(fixture.storage.current(), before);
        await fixture.storage.release();
        return scope.assert.collect();
    })
]);
