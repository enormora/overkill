import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import type { TestPlan } from '../engine/test-plan.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import { renderResolvedRunList } from './run-list-renderer.ts';
import type { ResolvedRun } from './run-types.ts';

const rowParameterIdentity = [
    '{"constructorName":"Object","entries":[{"key":{"kind":"string","value":"value"},',
    '"value":{"kind":"number","value":1}}],"kind":"object","truncation":null}'
]
    .join('');

function createLocationVariantPlan(): TestPlan {
    const engine = createTestEngine();
    const testNode = engine.createSuite({
        children: [
            engine.createTestCase({
                body(scope) {
                    scope.assert.true(true);
                    return scope.assert.collect();
                },
                definitionLocation: { column: null, file: '', line: null },
                metadata: {},
                name: 'no location'
            }),
            engine.createTestCase({
                body(scope) {
                    scope.assert.true(true);
                    return scope.assert.collect();
                },
                definitionLocation: { column: null, file: 'relative.test.ts', line: 7 },
                metadata: {},
                name: 'line only'
            }),
            engine.createTable({
                cases: [
                    {
                        body(scope) {
                            scope.assert.true(true);
                            return scope.assert.collect();
                        },
                        metadata: {},
                        name: 'row',
                        parameters: { value: 1 }
                    }
                ],
                definitionLocation: { column: null, file: '/outside/table.test.ts', line: null },
                metadata: {},
                name: 'rows'
            })
        ],
        metadata: {},
        name: 'suite'
    });

    return engine.createTestPlanFromTestFiles({
        files: [ { file: 'source/location-variants.test.ts', metadata: {}, testNode } ],
        root: { metadata: {}, name: 'root' }
    });
}

export const testSuite = createOverkillSuite({
    name: 'source/run/run-list-renderer.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'renderResolvedRunList() renders location variants',
            metadata: {},
            body(scope: OverkillScope) {
                const result = renderResolvedRunList(
                    {
                        plan: {
                            kind: 'local',
                            testPlan: createLocationVariantPlan()
                        }
                    } as ResolvedRun,
                    { cwd: process.cwd(), withLocations: true, withOrphans: false }
                );

                scope.assert.deepEqual(result, [
                    'source/location-variants.test.ts',
                    '  suite',
                    '    no location',
                    '    line only (relative.test.ts:7)',
                    '    rows (/outside/table.test.ts)',
                    `      row [${rowParameterIdentity}] (/outside/table.test.ts)`
                ]);

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
