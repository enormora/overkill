import { arch, platform } from 'node:os';
import { z } from 'zod/v4';

const referenceVersion = 4;
const decimalBase = 10;
const thresholdDigits = 2;
const hostSchema = z.strictObject({
    platform: z.string(),
    architecture: z.string(),
    node: z.string()
});

function performanceHost(): z.infer<typeof hostSchema> {
    return {
        platform: platform(),
        architecture: arch(),
        node: process.version
    };
}

const metric = z.object({ count: z.number(), maximum: z.number().nonnegative().nullable() });
const budget = z.object({
    metric: z.string(),
    decision: z.enum([ 'pass', 'fail', 'undecided', 'unavailable' ]),
    precise: z.boolean(),
    interval: z.object({ lower: z.number().nullable(), upper: z.number().nullable() }),
    maximum: z.number().nullable()
});
const benchmark = z.object({
    workload: z.object({ name: z.string() }),
    status: z.literal('complete'),
    samples: z.number().int().positive(),
    metrics: z.record(z.string(), metric),
    budgets: z.array(budget).min(1)
});

const evidenceSchema = z.object({
    entries: z.array(z.object({ benchmark: benchmark.nullable(), verdict: z.string() })),
    errors: z.array(z.string()),
    status: z.string()
});

const thresholdsSchema = z.record(z.string(), z.record(z.string(), z.number().nonnegative()).readonly()).readonly();
type PerformanceThresholds = z.infer<typeof thresholdsSchema>;

const referenceSchema = z.strictObject({
    version: z.literal(referenceVersion),
    host: hostSchema,
    samples: z.number().int().positive(),
    thresholds: thresholdsSchema
});

export function readReference(input: unknown): PerformanceThresholds {
    return referenceSchema.parse(input).thresholds;
}

type Evidence = Readonly<z.infer<typeof evidenceSchema>>;
type BenchmarkResult = Readonly<z.infer<typeof benchmark>>;
type Budget = Readonly<z.infer<typeof budget>>;

function completedResult(entry: Readonly<Evidence['entries'][number]>, samples: number): BenchmarkResult {
    const result = entry.benchmark;
    if (result === null || entry.verdict !== 'pass' || result.samples !== samples) {
        throw new Error(`Incomplete benchmark evidence: ${JSON.stringify(entry)}`);
    }
    return result;
}

function metricCeiling(result: BenchmarkResult, item: Budget): number {
    const summary = result.metrics[item.metric];
    const maximum = item.interval.upper;
    if (maximum === null || summary?.count !== result.samples || summary.maximum === null) {
        throw new Error(`Incomplete metric ${result.workload.name}/${item.metric}`);
    }
    return maximum;
}

function verifyBudget(id: string, item: Budget): void {
    if (
        item.decision !== 'pass' || !item.precise || item.maximum === null || item.interval.upper === null ||
        item.interval.upper > item.maximum
    ) {
        throw new Error(`Budget unproven for ${id}/${item.metric}: ${JSON.stringify(item)}`);
    }
}

function verifyInventory(
    evidence: Evidence,
    caseIds: readonly string[],
    thresholds: ReadonlyMap<string, Readonly<Record<string, number>>>
): void {
    if (evidence.status !== 'passed' || evidence.errors.length > 0 || thresholds.size !== caseIds.length) {
        const missing = caseIds.filter(function missingWorkload(id) {
            return !thresholds.has(id);
        });
        throw new Error(`Benchmark inventory failed: ${JSON.stringify({ errors: evidence.errors, missing })}`);
    }
}

function roundedCeiling(value: number): number {
    if (value === 0) {
        return 0;
    }
    const magnitude = Math.floor(Math.log10(value));
    const step = decimalBase ** (magnitude + 1 - thresholdDigits);
    return Number((Math.ceil(value / step) * step).toPrecision(thresholdDigits));
}

function thresholdsFor(
    input: unknown,
    caseIds: readonly string[],
    samples: number,
    compare: boolean
): PerformanceThresholds {
    const evidence = evidenceSchema.parse(input);
    const thresholds = new Map<string, Readonly<Record<string, number>>>();
    for (const entry of evidence.entries) {
        const result = completedResult(entry, samples);
        const id = result.workload.name;
        if (thresholds.has(id) || !caseIds.includes(id)) {
            throw new Error(`Unexpected or duplicate benchmark case ${id}`);
        }
        thresholds.set(
            id,
            Object.fromEntries(result.budgets.map(function (item) {
                if (compare) {
                    verifyBudget(id, item);
                }
                const ceiling = metricCeiling(result, item);
                return [ item.metric, compare ? ceiling : roundedCeiling(ceiling) ];
            }))
        );
    }
    verifyInventory(evidence, caseIds, thresholds);
    return Object.fromEntries(thresholds);
}

export function captureReference(
    input: unknown,
    caseIds: readonly string[],
    samples: number
): z.infer<typeof referenceSchema> {
    return {
        version: referenceVersion,
        host: performanceHost(),
        samples,
        thresholds: thresholdsFor(input, caseIds, samples, false)
    };
}

export function verifyPerformance(input: unknown, caseIds: readonly string[], samples: number): void {
    thresholdsFor(input, caseIds, samples, true);
}
