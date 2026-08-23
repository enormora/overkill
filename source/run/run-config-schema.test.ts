import { safeParse } from '@schema-hub/zod-error-formatter';
import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import type { $ZodType } from 'zod/v4/core';
import { createInMemoryRealTimeReporter } from '../reporters/in-memory-reporter.ts';
import {
    microtestExecutionSchema,
    microtestProfileSchema,
    resourceBudgetsSchema,
    resourceUsageSchema,
    timeoutSchema
} from './run-config-schema.ts';

type SchemaValidationFailure = {
    readonly data: unknown;
    readonly expectedIssues: readonly string[];
    readonly name: string;
    readonly schema: Readonly<$ZodType>;
};

function assertValidationSuccess(scope: OverkillScope, schema: Readonly<$ZodType>, data: unknown): void {
    const result = safeParse(schema, data);

    if (!result.success) {
        scope.assert.fail({ message: `Validation failed with: ${result.error.message}` });

        return;
    }

    scope.assert.deepEqual(result.data, data);
}

function assertValidationFailure(scope: OverkillScope, testCase: SchemaValidationFailure): void {
    const result = safeParse(testCase.schema, testCase.data);

    if (result.success) {
        scope.assert.fail({ message: 'Validation succeeded but a failure was expected' });

        return;
    }

    scope.assert.deepEqual(result.error.issues, testCase.expectedIssues);
}

const invalidMicrotestProfileFields: readonly SchemaValidationFailure[] = [
    {
        data: { testFamily: 'microtest', files: { exclude: [], include: [ 'source/**/*.test.ts' ] } },
        expectedIssues: [ 'unexpected additional property: "files"' ],
        name: 'files',
        schema: microtestProfileSchema
    },
    {
        data: { testFamily: 'microtest', coverage: { formats: [ 'text' ] } },
        expectedIssues: [ 'unexpected additional property: "coverage"' ],
        name: 'coverage',
        schema: microtestProfileSchema
    },
    {
        data: { testFamily: 'microtest', retries: { attempts: 2 } },
        expectedIssues: [ 'unexpected additional property: "retries"' ],
        name: 'retries',
        schema: microtestProfileSchema
    },
    {
        data: { testFamily: 'microtest', runtime: { name: 'node' } },
        expectedIssues: [ 'unexpected additional property: "runtime"' ],
        name: 'runtime',
        schema: microtestProfileSchema
    },
    {
        data: { testFamily: 'microtest', runtimes: [ 'node' ] },
        expectedIssues: [ 'unexpected additional property: "runtimes"' ],
        name: 'runtimes',
        schema: microtestProfileSchema
    },
    {
        data: { testFamily: 'microtest', capabilities: { fs: false } },
        expectedIssues: [ 'unexpected additional property: "capabilities"' ],
        name: 'capabilities',
        schema: microtestProfileSchema
    },
    {
        data: { testFamily: 'microtest', workers: 2 },
        expectedIssues: [ 'unexpected additional property: "workers"' ],
        name: 'workers',
        schema: microtestProfileSchema
    },
    {
        data: { testFamily: 'microtest', metadata: { tags: [ 'fast' ] } },
        expectedIssues: [ 'unexpected additional property: "metadata"' ],
        name: 'metadata',
        schema: microtestProfileSchema
    }
];

const invalidNestedFields: readonly SchemaValidationFailure[] = [
    {
        data: { processModel: 'in-process', workers: 2 },
        expectedIssues: [ 'unexpected additional property: "workers"' ],
        name: 'execution rejects workers',
        schema: microtestExecutionSchema
    },
    {
        data: { measure: true, extra: true },
        expectedIssues: [ 'unexpected additional property: "extra"' ],
        name: 'resourceUsage rejects extra',
        schema: resourceUsageSchema
    },
    {
        data: { activeResourceCount: 1, extra: true },
        expectedIssues: [ 'unexpected additional property: "extra"' ],
        name: 'resourceUsage.budgets rejects extra',
        schema: resourceBudgetsSchema
    },
    {
        data: { softMilliseconds: 1, extra: true },
        expectedIssues: [ 'unexpected additional property: "extra"' ],
        name: 'timeouts rejects extra',
        schema: timeoutSchema
    }
];

export const testSuite = createOverkillSuite({
    name: 'source/run/run-config-schema.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'microtest profile schema accepts the minimal profile',
            metadata: {},
            body(scope: OverkillScope) {
                assertValidationSuccess(scope, microtestProfileSchema, { testFamily: 'microtest' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'microtest profile schema accepts every current profile field',
            metadata: {},
            body(scope: OverkillScope) {
                const reporter = createInMemoryRealTimeReporter();

                assertValidationSuccess(scope, microtestProfileSchema, {
                    execution: {
                        processModel: 'in-process',
                        scheduling: 'serial'
                    },
                    reporters: [ reporter ],
                    resourceUsage: {
                        budgets: {
                            activeResourceCount: 1,
                            javaScriptEngineHeapBytes: null,
                            residentSetBytes: 2,
                            residentSetGrowthBytesPerSecond: 3
                        },
                        measure: true,
                        samplingIntervalMilliseconds: 4
                    },
                    testFamily: 'microtest',
                    timeouts: {
                        hardMilliseconds: 6,
                        softMilliseconds: 5
                    }
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'microtest execution schema accepts process model and scheduling variants',
            metadata: {},
            body(scope: OverkillScope) {
                for (const processModel of [ 'in-process', 'supervised-process' ] as const) {
                    for (const scheduling of [ 'concurrent', 'serial' ] as const) {
                        assertValidationSuccess(scope, microtestExecutionSchema, { processModel, scheduling });
                    }
                }

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'microtest resource usage schema accepts measured and unmeasured policies',
            metadata: {},
            body(scope: OverkillScope) {
                assertValidationSuccess(scope, resourceUsageSchema, { measure: false });
                assertValidationSuccess(scope, resourceUsageSchema, {
                    budgets: {
                        activeResourceCount: 1,
                        javaScriptEngineHeapBytes: 2,
                        residentSetBytes: null,
                        residentSetGrowthBytesPerSecond: 3
                    },
                    measure: true,
                    samplingIntervalMilliseconds: 4
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'microtest timeout schema accepts soft and hard timeouts',
            metadata: {},
            body(scope: OverkillScope) {
                assertValidationSuccess(scope, timeoutSchema, {
                    hardMilliseconds: 2,
                    softMilliseconds: 1
                });

                return scope.assert.collect();
            }
        }),
        ...invalidMicrotestProfileFields.map(function createInvalidMicrotestProfileFieldTest(testCase) {
            return createOverkillTestCase({
                name: `microtest profile schema rejects ${testCase.name}`,
                metadata: {},
                body(scope: OverkillScope) {
                    assertValidationFailure(scope, testCase);

                    return scope.assert.collect();
                }
            });
        }),
        ...invalidNestedFields.map(function createInvalidNestedFieldTest(testCase) {
            return createOverkillTestCase({
                name: `microtest profile nested schema ${testCase.name}`,
                metadata: {},
                body(scope: OverkillScope) {
                    assertValidationFailure(scope, testCase);

                    return scope.assert.collect();
                }
            });
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
