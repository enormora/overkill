import { type TestScope, suite as authoredSuite, test as authoredTest } from '@overkill-dev/test';

import { executionSessionRuntime } from '../test-support/execution-session-runtime.ts';
import { normalizeExecutionSessionOptions } from './execution-session-schema.ts';

export const testNode = authoredSuite('memory execution session admission', [
    ...[
        { change: { lastFailed: true }, message: 'Memory execution sessions do not support last-failed recording.' },
        {
            change: { coverage: true },
            message: 'Memory execution sessions do not support recorded coverage or baseline updates.'
        },
        {
            change: { baselineUpdateMode: 'update' as const },
            message: 'Memory execution sessions do not support recorded coverage or baseline updates.'
        },
        {
            change: { debug: { mode: 'all' as const, selectors: [] as const } },
            message: 'Memory execution sessions do not support persisted debug recording.'
        }
    ]
        .map(function (scenario, index) {
            return authoredTest(`rejects persisted session policy ${index}`, async function (scope: TestScope) {
                const fixture = await executionSessionRuntime();
                const { command } = fixture.options;
                const supplied = {
                    ...fixture.options,
                    command: {
                        ...command,
                        policy: { ...command.policy, request: { ...command.policy.request, ...scenario.change } }
                    }
                };
                scope.assert.throws(function () {
                    normalizeExecutionSessionOptions(supplied, fixture.runtime.createSeed);
                }, { message: scenario.message });
                return scope.assert.collect();
            });
        }),
    authoredTest('generates a seed when invocation does not supply one', async function (scope: TestScope) {
        const fixture = await executionSessionRuntime();
        const { command } = fixture.options;
        const supplied = {
            ...fixture.options,
            command: { ...command, invocation: { ...command.invocation, seed: { value: null } } }
        };
        const normalized = normalizeExecutionSessionOptions(supplied, fixture.runtime.createSeed);
        scope.assert.equal(normalized.command.invocation.seed.value, 42n);
        scope.assert.notEqual(normalized.lifecycle, supplied.lifecycle);
        return scope.assert.collect();
    })
]);
