import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import { observationPlan } from '../test-support/observation-lifetime.ts';
import { supervisedChildCommand } from '../test-support/supervised-child-fixture.ts';
import { defaultPropertyPolicy } from '../engine/property-policy.ts';
import { createHostTestPlan, resolveHostEngine } from './host-test-plan.ts';

export const testNode = suite('host collection policy forwarding', [
    ...([ 'integration', 'property' ] as const).map(function (testFamily) {
        return test(
            `forwards ${testFamily} collection policy without executing cases`,
            async function (scope: TestScope) {
                const command = {
                    ...supervisedChildCommand('collect', 'case.ts'),
                    testFamily,
                    propertyPolicy: defaultPropertyPolicy
                };
                const seen: unknown[] = [];
                const plan = observationPlan();
                const result = await createHostTestPlan({
                    command,
                    processModel: 'supervised-process',
                    engine: createTestEngine(),
                    async collect(policy, replay) {
                        seen.push({ policy, replay });
                        return plan;
                    }
                });
                scope.assert.deepEqual(seen, [ {
                    policy: {
                        runtimeMatrices: true,
                        benchmarkCalibration: false,
                        property: {
                            testFamily,
                            policy: defaultPropertyPolicy,
                            timeoutMilliseconds: command.timeoutMilliseconds
                        }
                    },
                    replay: null
                } ]);
                scope.assert.equal(result.cases[0].id.title, 'owned case');
                return scope.assert.collect();
            }
        );
    }),
    test('resolves explicit engine modules through the provided loader', async function (scope: TestScope) {
        const engine = createTestEngine();
        const selection = {
            kind: 'module',
            moduleUrl: 'file:///project/engine.ts',
            exportName: 'engine',
            exportKind: 'value'
        } as const;
        const observed: unknown[] = [];
        const result = await resolveHostEngine(selection, async function (input) {
            observed.push(input);
            return engine;
        });
        scope.assert.equal(result, engine);
        scope.assert.deepEqual(observed, [ selection ]);
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
