import { table, type TestNode, suite, test } from '@overkill-dev/test';

import { executionSessionRuntime } from '../test-support/execution-session-runtime.ts';
import { normalizeExecutionSessionOptions } from './execution-session-schema.ts';

export const testNode: TestNode = suite('memory execution session admission', [
    table({
        title: 'rejects persisted session policy',
        cases: [ {
            description: 'last-failed selection',
            input: {
                change: { lastFailed: true },
                message: 'Memory execution sessions do not support last-failed recording.'
            }
        }, {
            description: 'recorded coverage',
            input: {
                change: { coverage: true },
                message: 'Memory execution sessions do not support recorded coverage or baseline updates.'
            }
        }, {
            description: 'baseline updates',
            input: {
                change: { baselineUpdateMode: 'update' as const },
                message: 'Memory execution sessions do not support recorded coverage or baseline updates.'
            }
        }, {
            description: 'persisted debugging',
            input: {
                change: { debug: { mode: 'all' as const, selectors: [] as const } },
                message: 'Memory execution sessions do not support persisted debug recording.'
            }
        } ],
        caseTitle({ description }) {
            return description;
        },
        async test(scope) {
            const scenario = scope.parameters.input;

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
        }
    }),
    test('generates a seed when invocation does not supply one', async function (scope) {
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
