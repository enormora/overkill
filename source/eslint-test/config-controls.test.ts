import { suite, test } from '@overkill-dev/test';
import { captureThrownError } from '../test-support/captured-error.ts';

import { ResourceLifecycleError } from '../packages/resources/resources.entry-point.ts';
import { emptyConfigProject } from '../test-support/eslint-config.ts';
import { projectFailure, propagateConfigControls } from './config-errors.ts';
import { trialCandidates } from './config-seeds.ts';

export const testNode = suite('config execution controls', [
    test('rejects replay references to removed fixtures', async function (scope) {
        await scope.assert.rejects(async function removed() {
            await trialCandidates(
                { kind: 'fixture', fixture: 'removed' },
                { project: emptyConfigProject, sources: [] },
                scope.signal
            );
        }, { message: 'The replayed fixture no longer exists.' });
        return scope.assert.collect();
    }),
    test('preserves wrapped permission failures from project resources', function (scope) {
        const denied = Object.assign(new Error('denied'), { code: 'ERR_ACCESS_DENIED' });
        const wrapped = new ResourceLifecycleError('acquisition failed', {
            cause: denied,
            failures: [ { cause: denied, phase: 'acquire', resourceName: 'project' } ]
        });
        scope.assert.equal(
            captureThrownError(function control() {
                propagateConfigControls(wrapped, scope.signal);
            })
                ?.message,
            'denied'
        );
        const ordinary = new Error('outer', { cause: denied });
        scope.assert.equal(
            captureThrownError(function cause() {
                propagateConfigControls(ordinary, scope.signal);
            })
                ?.message,
            'denied'
        );
        return scope.assert.collect();
    }),
    test(
        'normalizes portable failure text and handles missing stacks and non-error throws',
        function (scope) {
            const error = new Error('/project/file.js failed');
            Reflect.deleteProperty(error, 'stack');
            const normalized = projectFailure(error, '/project', scope.signal);
            if (!(normalized instanceof Error)) {
                throw new TypeError('Expected an error.');
            }
            scope.assert.equal(normalized.message, '<project>/file.js failed');
            scope.assert.false(String(normalized.stack).includes('/project/file.js'));
            const thrown = { reason: 'plugin failure' };
            scope.assert.equal(projectFailure(thrown, '/project', scope.signal), thrown);
            return scope.assert.collect();
        }
    ),
    test('cancellation retains priority over ordinary rule errors', function (scope) {
        const controller = new AbortController();
        controller.abort(new Error('cancelled'));
        scope.assert.throws(function aborted() {
            projectFailure(new Error('rule crash'), '/project', controller.signal);
        }, { message: 'cancelled' });
        return scope.assert.collect();
    })
]);
