import { runIfMain } from '#test-runner';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { defineReporter, type PropertyCaseEvidence, type TestScope } from '../packages/engine/engine.entry-point.ts';
import { executePropertyNode, propertyExecutionDefaults } from '../test-support/property-execution.ts';
import { property } from './property-authoring.ts';
import { gen } from './generators.ts';

export const testNode = suite('property progress', [
    test('delivers immutable snapshots before trial evaluation', async function (scope: TestScope) {
        const snapshots: PropertyCaseEvidence[] = [];
        let calls = 0;
        const reporter = defineReporter(function captureProgress() {
            return {
                kind: 'real-time',
                name: 'property progress',
                sinks: [],
                dispose: null,
                onFinish: null,
                onEvent(event) {
                    if (event.kind === 'property-progress') {
                        snapshots.push(event.property);
                    }
                }
            };
        });
        const result = await executePropertyNode(
            property({
                title: 'snapshot ordering',
                generator: gen.constant(1),
                test(value, sample) {
                    calls += 1;
                    sample.assert.equal(snapshots.at(-1)?.invocations[0]?.summary?.trial?.index, calls);
                    sample.assert.equal(value, 1);
                    return sample.assert.collect();
                }
            }),
            { ...propertyExecutionDefaults, reporters: [ reporter ] }
        );
        scope.assert.equal(result.summary.passed, 1);
        scope.assert.equal(snapshots[0]?.invocations[0]?.summary?.accounting.phases.exploration.executed, 0);
        scope.assert.equal(JSON.stringify(snapshots.at(-1)), JSON.stringify(result.perTest[0]?.property));
        return scope.assert.collect();
    })
]);

await runIfMain(import.meta, testNode);
