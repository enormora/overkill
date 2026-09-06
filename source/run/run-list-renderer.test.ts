import { createLineReporter as createOverkillLineReporter } from '../packages/reporter-line/reporter-line.entry-point.ts';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import type { TestPlan } from '../engine/test-plan.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import { renderResolvedRunList } from './run-list-renderer.ts';
import type { ResolvedRun } from './run-types.ts';

const rowParameterIdentity = [
    '{"constructorName":"Object","entries":[{"key":{"kind":"string","value":"value"},',
    '"value":{"kind":"number","value":1}}],"kind":"object","truncation":null}'
]
    .join('');
const otherRowParameterIdentity = [
    '{"constructorName":"Object","entries":[{"key":{"kind":"string","value":"value"},',
    '"value":{"kind":"number","value":2}}],"kind":"object","truncation":null}'
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
                title: 'no location'
            }),
            engine.createTestCase({
                body(scope) {
                    scope.assert.true(true);
                    return scope.assert.collect();
                },
                definitionLocation: { column: null, file: 'relative.test.ts', line: 7 },
                metadata: {},
                title: 'line only'
            }),
            engine.createTable({
                cases: [
                    {
                        body(scope) {
                            scope.assert.true(true);
                            return scope.assert.collect();
                        },
                        metadata: {},
                        title: 'row',
                        parameters: { value: 1 }
                    },
                    {
                        body(scope) {
                            scope.assert.true(true);
                            return scope.assert.collect();
                        },
                        metadata: {},
                        title: 'other row',
                        parameters: { value: 2 }
                    }
                ],
                definitionLocation: { column: null, file: '/outside/table.test.ts', line: null },
                metadata: {},
                title: 'rows'
            })
        ],
        metadata: {},
        title: 'suite'
    });

    return engine.createTestPlanFromTestFiles({
        files: [ { file: 'source/location-variants.test.ts', metadata: {}, testNode } ],
        root: { metadata: {}, title: 'root' }
    });
}

export const testSuite = createOverkillSuite({
    title: 'source/run/run-list-renderer.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            title: 'renderResolvedRunList() renders location variants',
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
                    `      row [${rowParameterIdentity}] (/outside/table.test.ts)`,
                    `      other row [${otherRowParameterIdentity}] (/outside/table.test.ts)`
                ]);

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
