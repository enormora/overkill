import { z } from 'zod/v4';
import { createDefaultWorkId } from '../engine/identity.ts';
import {
    annotationsSchema,
    controlsSchema,
    sourceLocationsSchema,
    suitePathSchema,
    workIdSchema
} from '../engine/identity-schema.ts';
import type { CollectedRunPlan } from './run-types.ts';

const requirementSchema = z.record(z.string(), z.unknown());
const directResourceSchema = z.strictObject({ key: z.string(), resourceName: z.string() });
const scenarioSchema = z.strictObject({
    default: z.string(),
    name: z.string(),
    timing: z.enum([ 'acquire', 'request-routed' ]),
    values: z.array(z.string())
});
const resourceSchema = z.strictObject({
    dependencies: z.array(z.string()),
    handleTransport: z.enum([ 'local', 'projected' ]),
    name: z.string(),
    requirements: z.array(requirementSchema),
    scenarios: z.array(scenarioSchema),
    scope: z.string()
});
const runtimeSchema = z.strictObject({
    dimensions: z.record(z.string(), z.string()),
    kind: z.literal('runtime').default('runtime'),
    name: z.string(),
    requirements: z.array(requirementSchema),
    resources: z.array(directResourceSchema),
    scenarioBindings: z.array(
        scenarioSchema.extend({
            owner: z.strictObject({ path: z.array(z.string()), resourceName: z.string() }),
            value: z.string()
        })
    )
});
const attachmentsSchema = z.strictObject({
    directResources: z.array(directResourceSchema),
    resourceGraph: z.array(resourceSchema),
    runtimeGraphs: z.array(
        z.union([
            runtimeSchema,
            z.strictObject({
                kind: z.literal('runtime-matrix'),
                name: z.string(),
                resources: z.array(directResourceSchema),
                variants: z.array(z.strictObject({ id: z.string(), runtime: runtimeSchema }))
            })
        ])
    )
});
const fileSchema = z
    .strictObject({
        cases: z.array(z.strictObject({
            annotations: annotationsSchema,
            controls: controlsSchema,
            definitionLocations: sourceLocationsSchema,
            params: z.string().nullable(),
            resourceAttachments: attachmentsSchema,
            suitePath: suitePathSchema,
            testFamily: z.enum([ 'benchmark', 'integration', 'microtest', 'property', 'type-test' ]).nullable(),
            title: z.string(),
            workId: workIdSchema.optional()
        })),
        file: z.string()
    })
    .transform(function normalizeWorkIdentities(file) {
        return {
            ...file,
            cases: file.cases.map(function normalizeCase(testCase) {
                return {
                    ...testCase,
                    workId: testCase.workId ??
                        createDefaultWorkId({
                            file: file.file,
                            params: testCase.params,
                            suite: testCase.suitePath.map(function suiteTitle(suite) {
                                return suite.title;
                            }),
                            title: testCase.title
                        })
                };
            })
        };
    });
export const collectedRunPlanSchema: z.ZodType<CollectedRunPlan> = z.strictObject({
    defined: z.number(),
    discoveredFiles: z.array(fileSchema),
    files: z.array(fileSchema),
    orphans: z.array(
        z.strictObject({
            definitionLocations: sourceLocationsSchema,
            file: z.string().nullable(),
            kind: z.enum([ 'suite', 'table', 'test' ]),
            title: z.string()
        })
    ),
    root: z.strictObject({ annotations: annotationsSchema, controls: controlsSchema, title: z.string() })
});
