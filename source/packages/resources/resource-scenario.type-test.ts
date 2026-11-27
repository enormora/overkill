import { test } from '@overkill-dev/test-type-authoring';
import { acceptsCall, sameType } from '@overkill-dev/type-test';
import { hasKey } from '../../test-support/type-relations.ts';
import { defineResource, type RuntimeAttachments } from './resources.entry-point.ts';

declare const attachments: RuntimeAttachments;

export const testNode = test('separates acquisition and handle exposure bindings', function (typeScope) {
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
            typeScope.assert(sameType.withActual<false>(), hasKey<'database'>()(context.scenarios));

            return 'database';
        },
        dispose(_handle, context) {
            typeScope.assert(sameType.withActual<false>(), hasKey<'database'>()(context.scenarios));
        },
        exposeHandle(handle, context) {
            typeScope.assert(sameType.withActual<'primary' | 'replica'>(), context.scenarios.database);

            return `${handle}:${context.scenarios.database}`;
        }
    });
    typeScope.assert(acceptsCall, () =>
        routedScenarioDatabase.exposeHandle('database', {
            attachments,
            scenarios: { database: 'replica' }
        }));
    return typeScope.assert.collect();
});
