import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import { supervisedChildCommand } from '../test-support/supervised-child-fixture.ts';
import { testNode as collectionPolicy } from './host-collection-policy.test.ts';
import { createHostTestPlan } from './host-test-plan.ts';
import type { FrozenFamilyDefinition } from './family-catalog.ts';

const family: FrozenFamilyDefinition = {
    id: '@example/family',
    version: '1',
    settings: null,
    projectRoot: '/project',
    processModel: 'in-process',
    definitionLocationCapture: 'disabled',
    checkpoint: null,
    selection: null,
    source: { kind: 'module', module: { moduleUrl: 'file:///project/family.ts', exportName: 'family' } }
};
export const testNode = suite(
    'imported family host validation',
    [
        collectionPolicy,
        ...([ 'supervised-process', 'worker-pool' ] as const).flatMap(function (processModel) {
            return [ false, true ].map(function (matches) {
                return test(
                    `rejects imported family on ${processModel} with matching identity ${matches}`,
                    async function (scope: TestScope) {
                        await scope.assert.rejects(async function () {
                            await createHostTestPlan({
                                processModel,
                                engine: createTestEngine(),
                                command: {
                                    ...supervisedChildCommand('collect', 'case.ts'),
                                    family,
                                    testFamily: matches
                                        ? family.id
                                        : 'other'
                                },
                                async collect() {
                                    throw new Error('Invalid host must not collect.');
                                }
                            });
                        }, {
                            message: matches
                                ? 'Frozen family placement is inconsistent.'
                                : 'Frozen family command identity is inconsistent.'
                        });
                        return scope.assert.collect();
                    }
                );
            });
        })
    ]
);
await runIfMain(import.meta, testNode);
