import { runIfMain } from '#test-runner';
import { test } from '../packages/test/test.entry-point.ts';
import { defineReporter, readPropertyExecutionHost } from '../packages/engine/engine.entry-point.ts';
import { executePropertyNode, propertyExecutionDefaults } from '../test-support/property-execution.ts';
import { withProperties } from './property-authoring.ts';
import { normalizePropertyInvocation } from './property-invocation.ts';
import { executeProperty } from './property-execution.ts';
import { gen } from './generators.ts';

export const testNode = test('cancellation preserves failure evidence before confirmation', async function (scope) {
    const controller = new AbortController();
    let calls = 0;
    const node = test(
        'canceled property invocation',
        withProperties(async function (parent) {
            const invocation = normalizePropertyInvocation({
                generator: gen.constant(1),
                test(_value, sample) {
                    calls += 1;
                    sample.assert.fail({ message: 'retained before cancellation' });
                    return sample.assert.collect();
                }
            });
            await parent.assert.rejects(async function () {
                return executeProperty(invocation, { checkedIn: [], localCache: [] }, {
                    host: readPropertyExecutionHost(parent),
                    signal: controller.signal,
                    identity: 'canceled-invocation'
                });
            }, { message: 'Cancel retained failure.' });
            return parent.assert.collect();
        })
    );
    const result = await executePropertyNode(node, {
        ...propertyExecutionDefaults,
        reporters: [ defineReporter(function cancelAfterFailure() {
            return {
                kind: 'real-time',
                name: 'cancel retained failure',
                sinks: [],
                dispose: null,
                onFinish: null,
                onEvent(event) {
                    if (event.kind === 'property-progress') {
                        controller.abort(new Error('Cancel retained failure.'));
                    }
                }
            };
        }) ]
    });
    scope.assert.equal(result.summary.passed, 1);
    scope.assert.equal(calls, 1);
    scope.assert.equal(result.perTest[0]?.property?.invocations[0]?.shrinkStatus, 'interrupted');
    scope.assert.includes(JSON.stringify(result.perTest[0]?.property), 'retained before cancellation');
    return scope.assert.collect();
});

await runIfMain(import.meta, testNode);
