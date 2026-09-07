import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
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
        definitionLocations: [ { column: null, file: '', line: null } ],
        children: [
            engine.createTestCase({
                body(scope) {
                    scope.assert.true(true);
                    return scope.assert.collect();
                },
                definitionLocations: [ { column: null, file: '', line: null } ],
                metadata: {},
                title: 'no location'
            }),
            engine.createTestCase({
                body(scope) {
                    scope.assert.true(true);
                    return scope.assert.collect();
                },
                definitionLocations: [
                    { column: null, file: 'relative.test.ts', line: 7 },
                    { column: null, file: '', line: null },
                    { column: null, file: 'macro.test.ts', line: 5 },
                    { column: null, file: 'constructed.test.ts', line: null }
                ],
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
                definitionLocations: [ { column: null, file: '/outside/table.test.ts', line: null } ],
                metadata: {},
                title: 'rows'
            })
        ],
        metadata: {},
        title: 'suite'
    });

    return engine.createTestPlanFromTestFiles({
        files: [ { file: 'source/location-variants.test.ts', testNode } ],
        root: { metadata: {}, title: 'root' }
    });
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { column: null, file: '', line: null } ],
    title: 'source/run/run-list-renderer.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { column: null, file: '', line: null } ],
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
                    '      expanded at macro.test.ts:5',
                    '      constructed at constructed.test.ts',
                    '    rows (/outside/table.test.ts)',
                    `      row [${rowParameterIdentity}] (/outside/table.test.ts)`,
                    `      other row [${otherRowParameterIdentity}] (/outside/table.test.ts)`
                ]);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
