import { test } from '@overkill-dev/test';
import { acceptsCall, sameType } from '@overkill-dev/type-test';
import { hasKey } from '../../test-support/type-relations.ts';
import { defineResource, type RuntimeAttachments } from './resources.entry-point.ts';

declare const attachments: RuntimeAttachments;

export const testNode = test('separates acquisition and handle exposure bindings', function (scope) {
    const routedScenarioDatabase = defineResource({
        name: 'routed-scenario-database',
        scope: 'per-case',
        requirements: [],
        scenarios: {
            database: {
                default: 'primary',
                timing: 'request-routed',
                values: [ 'primary', 'replica' ]
            }
        },
        acquire(context): string {
            scope.assert(sameType.withActual<false>(), hasKey<'database'>()(context.scenarios));

            return 'database';
        },
        dispose(_handle, context) {
            scope.assert(sameType.withActual<false>(), hasKey<'database'>()(context.scenarios));
        },
        exposeHandle(handle, context) {
            scope.assert(sameType.withActual<'primary' | 'replica'>(), context.scenarios.database);

            return `${handle}:${context.scenarios.database}`;
        }
    });
    scope.assert(acceptsCall, function () {
        return routedScenarioDatabase.exposeHandle('database', {
            attachments,
            scenarios: { database: 'replica' }
        });
    });
    return scope.assert.collect();
});
