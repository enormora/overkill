import { z } from 'zod/v4';

const coverageOutputSchema = z.enum([ 'html', 'json', 'lcov', 'text', 'v8' ]);
const fileGlobSchema = z.string();

const coverageSourcesSchema = z.discriminatedUnion('mode', [
    z
        .strictObject({
            exclude: z.optional(z.array(fileGlobSchema).readonly()),
            mode: z.literal('loaded')
        })
        .readonly(),
    z
        .strictObject({
            exclude: z.optional(z.array(fileGlobSchema).readonly()),
            include: z.tuple([ fileGlobSchema ]).rest(fileGlobSchema).readonly(),
            mode: z.literal('all')
        })
        .readonly()
]);

const maximumCoveragePercentage = 100;
const coveragePercentageSchema = z.number().min(0).max(maximumCoveragePercentage);

const coverageThresholdsSchema = z
    .strictObject({
        branches: z.optional(coveragePercentageSchema),
        functions: z.optional(coveragePercentageSchema),
        lines: z.optional(coveragePercentageSchema)
    })
    .readonly();

export const coveragePolicySchema = z
    .strictObject({
        outputDir: z.optional(z.string().min(1)),
        outputs: z.optional(z.array(coverageOutputSchema).readonly()),
        sources: z.optional(coverageSourcesSchema),
        thresholds: z.optional(coverageThresholdsSchema)
    })
    .readonly();

export type ProjectCoverageOutput = z.infer<typeof coverageOutputSchema>;
export type ProjectCoveragePolicy = z.infer<typeof coveragePolicySchema>;
export type ProjectCoverageSources = z.infer<typeof coverageSourcesSchema>;
export type ProjectCoverageThresholds = z.infer<typeof coverageThresholdsSchema>;
