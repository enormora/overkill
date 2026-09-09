import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import type { TestPlan } from '../engine/test-plan.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import {
    defaultMicrotestProfile,
    defaultRunConfig,
    defaultRunRequest
} from '../test-support/run-command-factory.ts';
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
const emptySerializedMetadata = { constructorName: 'Object', entries: [], kind: 'object', truncation: null } as const;

function createLocationVariantPlan(): TestPlan {
    const engine = createTestEngine();
    const testNode = engine.createSuite({
        definitionLocations: [ { kind: 'unknown' as const } ],
        children: [
            engine.createTestCase({
                body(scope) {
                    scope.assert.true(true);
                    return scope.assert.collect();
                },
                definitionLocations: [ { kind: 'unknown' as const } ],
                metadata: {},
                title: 'no location'
            }),
            engine.createTestCase({
                body(scope) {
                    scope.assert.true(true);
                    return scope.assert.collect();
                },
                definitionLocations: [
                    { column: null, file: 'relative.test.ts', kind: 'known' as const, line: 7 },
                    { kind: 'unknown' as const },
                    { column: null, file: 'macro.test.ts', kind: 'known' as const, line: 5 },
                    { column: null, file: 'constructed.test.ts', kind: 'known' as const, line: null }
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
                definitionLocations: [ {
                    column: null,
                    file: '/outside/table.test.ts',
                    kind: 'known' as const,
                    line: null
                } ],
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

function createResolvedRun(testPlan: TestPlan): ResolvedRun {
    const profile = defaultMicrotestProfile({
        execution: { processModel: 'in-process', scheduling: 'serial' }
    });
    const config = defaultRunConfig({
        profiles: { microtest: profile }
    });
    const request = defaultRunRequest({
        order: 'lexical',
        seed: { value: 42n }
    });

    return {
        collectionRunnerErrors: [],
        config,
        cwd: process.cwd(),
        engine: { kind: 'default' },
        facts: {
            cases: testPlan.cases.map(function toCaseFacts(testCase) {
                return {
                    fileSet: null,
                    id: testCase.id,
                    metadata: emptySerializedMetadata
                };
            }),
            environment: {
                node: { arch: 'x64', platform: 'linux', version: '26.1.1' },
                projectRoot: process.cwd(),
                runtimeStateDir: config.runtimeStateDir
            },
            execution: {
                baselineUpdateMode: request.baselineUpdateMode,
                capture: request.capture,
                debug: request.debug,
                engine: { kind: 'default' },
                order: request.order,
                processModel: profile.execution.processModel,
                profile: request.profile,
                resourceUsagePolicy: profile.resourceUsage,
                scheduling: profile.execution.scheduling,
                testFamily: profile.testFamily,
                timeoutPolicy: profile.timeouts,
                verbose: request.verbose
            },
            loader: config.loader,
            reproducibility: {
                selection: request.selection,
                seed: '42',
                shard: request.shard
            }
        },
        plan: { kind: 'local', testPlan },
        reporters: [],
        request
    };
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/run-list-renderer.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'renderResolvedRunList() renders location variants',
            metadata: {},
            body(scope: OverkillScope) {
                const testPlan = createLocationVariantPlan();
                const result = renderResolvedRunList(
                    createResolvedRun(testPlan),
                    { withLocations: true, withOrphans: false }
                );

                scope.assert.deepEqual(result, [
                    'order=lexical seed=42',
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
