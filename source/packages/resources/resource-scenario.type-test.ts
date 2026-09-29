import { describe, expect, test } from 'tstyche';
import { defineResource } from './resources.entry-point.ts';

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
        expect(context.scenarios).type.not.toHaveProperty('database');

        return 'database';
    },
    dispose(_handle, context) {
        expect(context.scenarios).type.not.toHaveProperty('database');
    },
    exposeHandle(handle, context) {
        expect(context.scenarios.database).type.toBe<'primary' | 'replica'>();

        return `${handle}:${context.scenarios.database}`;
    }
});

describe('resource scenarios', function () {
    test('separates acquisition and handle exposure bindings', function () {
        expect(routedScenarioDatabase.exposeHandle).type.toBeCallableWith('database', {
            scenarios: { database: 'replica' }
        });
    });
});
