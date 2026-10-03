import { safeParse } from '@schema-hub/zod-error-formatter';
import {
    createSuite,
    createTestCase,
    type TestScope
} from '../packages/engine/engine.entry-point.ts';
import { microtestProfileSchema } from './run-config-schema.ts';

function validationIssues(data: unknown): readonly string[] {
    const result = safeParse(microtestProfileSchema, data);

    return result.success ? [] : result.error.issues;
}

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/run/coverage-config-schema.test.ts',
    annotations: {},
    controls: {},
    children: [
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'coverage policy accepts every output and all-files source policy',
            annotations: {},
            controls: {},
            body(scope: TestScope) {
                scope.assert.deepEqual(
                    validationIssues({
                        coverage: {
                            outputDir: 'coverage',
                            outputs: [ 'html', 'json', 'lcov', 'text', 'v8' ],
                            sources: {
                                exclude: [ '**/*.generated.ts' ],
                                include: [ 'source/**/*.ts' ],
                                mode: 'all'
                            },
                            thresholds: { branches: 80, functions: 90, lines: 100 }
                        },
                        testFamily: 'microtest'
                    }),
                    []
                );

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'coverage policy validates thresholds and all-files includes',
            annotations: {},
            controls: {},
            body(scope: TestScope) {
                scope.assert.deepEqual(
                    validationIssues({
                        coverage: { thresholds: { lines: 101 } },
                        testFamily: 'microtest'
                    }),
                    [ 'at coverage.thresholds.lines: number must be less than or equal to 100' ]
                );
                scope.assert.deepEqual(
                    validationIssues({
                        coverage: { sources: { include: [], mode: 'all' } },
                        testFamily: 'microtest'
                    }),
                    [ 'at coverage.sources.include[0]: missing key; expected string' ]
                );

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
