import { table, type TestNode, suite } from '@overkill-dev/test';

import { createTestEngine } from '../test-support/create-test-engine.ts';
import { supervisedChildCommand } from '../test-support/supervised-child-fixture.ts';

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
export const testNode: TestNode = suite(
    'imported family host validation',
    [ table({
        title: 'rejects incompatible imported families',
        cases: ([ 'supervised-process', 'worker-pool' ] as const).flatMap(function (processModel) {
            return [ false, true ].map(function (matches) {
                return { processModel, matches };
            });
        }),
        caseTitle({ processModel, matches }) {
            return [ processModel, matches ].map(String).join(', ');
        },
        async test(scope) {
            const { processModel, matches } = scope.parameters;

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
    }) ]
);
