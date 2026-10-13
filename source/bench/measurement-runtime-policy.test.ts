import { createRoot, createTestPlan, type TestCase, type RunResult } from '../packages/engine/engine.entry-point.ts';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import { benchmark } from './benchmark-authoring.ts';
import { wallClockMeasurement } from './measurement-strategy.ts';
import { workload } from './workload.ts';

async function executeWithLeakDetection(node: TestCase): Promise<RunResult> {
    const plan = createTestPlan(createRoot({ title: 'root', children: [ node ], annotations: {}, controls: {} }));
    return await createTestEngine().execute(plan);
}

export const testNode = suite('measurement async leak attribution', [
    test('excludes checkpoint delivery promises from workload leak evidence', async function (scope) {
        const result = await executeWithLeakDetection(benchmark('clean', {
            kind: 'runtime',
            workloads: [ workload('one', {}) ],
            measurement: wallClockMeasurement(),
            measure({ sample }) {
                const measured = sample.measure(function () {
                    return 1;
                });
                return { value: measured.value };
            },
            diagnosticMetrics: [],
            budgets: { one: { value: { maximum: 2 } } }
        }));
        scope.assert.equal(result.summary.passed, 1);
        scope.assert.deepEqual(result.runnerErrors, []);
        return scope.assert.collect();
    }),
    test('still detects promises leaked by measured callbacks', async function (scope) {
        const pending = {
            resolve() {
                return undefined;
            }
        };
        const node = benchmark('leaking', {
            kind: 'runtime',
            workloads: [ workload('one', {}) ],
            measurement: wallClockMeasurement(),
            measure({ sample }) {
                sample.measure(function () {
                    const promise = Promise.withResolvers<undefined>();
                    pending.resolve();
                    pending.resolve = function () {
                        promise.resolve(undefined);
                    };
                });
                return { value: 1 };
            },
            diagnosticMetrics: [],
            budgets: { one: { value: { maximum: 2 } } }
        });
        scope.cleanup(function () {
            pending.resolve();
        });
        const result = await executeWithLeakDetection(node);
        scope.assert.equal(result.perTest[0]?.verdict, 'runtime-policy');
        scope.assert.equal(result.runnerErrors[0]?.subtype, 'runtime-policy');
        return scope.assert.collect();
    })
]);
