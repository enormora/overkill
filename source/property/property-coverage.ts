import { z } from 'zod/v4';
import type { PropertyCoverageRequirement } from './property-definition.ts';

const percentScale = 100;
const decimalBase = 10n;
const labelSchema = z.string().refine(function nonblank(label) {
    return label.trim().length > 0;
});
const requirementsSchema = z
    .array(
        z
            .strictObject({
                label: labelSchema,
                minimumPercent: z.number().min(0).max(percentScale)
            })
            .readonly()
    )
    .refine(function uniqueLabels(entries) {
        const labels = new Set(entries.map(function (entry) {
            return entry.label;
        }));
        return labels.size === entries.length;
    })
    .readonly();

export type CoverageSnapshot = {
    readonly denominator: number;
    readonly requirements: readonly PropertyCoverageRequirement[];
    readonly phases: Readonly<Record<string, Readonly<Record<string, number>>>>;
};

export type CoverageTrial = {
    readonly cover: (label: string, condition: boolean) => void;
    readonly finish: (passed: boolean) => void;
};
export type PropertyCoverage = {
    readonly trial: (phase: string) => CoverageTrial;
    readonly snapshot: () => CoverageSnapshot;
    readonly unmet: () => readonly PropertyCoverageRequirement[];
};

export function coverageRequirements(value: unknown): readonly PropertyCoverageRequirement[] {
    return requirementsSchema.parse(value);
}

function countHits(previous: ReadonlyMap<string, number>, hits: ReadonlySet<string>): Map<string, number> {
    const counts = new Map(previous);
    for (const label of hits) {
        counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return counts;
}

function trialCoverage(observe: (label: string) => void, commit: (hits: ReadonlySet<string>) => void): CoverageTrial {
    let active = true;
    const hits = new Set<string>();
    return {
        cover(label, condition) {
            if (!active) {
                throw new TypeError('Property coverage observation outlived its trial.');
            }
            labelSchema.parse(label);
            z.boolean().parse(condition);
            observe(label);
            if (condition) {
                hits.add(label);
            }
        },
        finish(passed) {
            active = false;
            if (passed) {
                commit(hits);
            }
        }
    };
}

function meetsPercentage(hits: number, denominator: number, percent: number): boolean {
    const [ coefficient = '0', exponent = '0' ] = String(percent).split('e');
    const [ whole = '0', fraction = '' ] = coefficient.split('.');
    const precision = fraction.length - Number(exponent);
    const units = BigInt(whole + fraction);
    const scale = decimalBase ** BigInt(Math.abs(precision));
    const observed = BigInt(hits) * BigInt(percentScale);
    const required = BigInt(denominator) * units;
    return precision >= 0 ? observed * scale >= required : observed >= required * scale;
}

export function createCoverage(
    requirements: readonly PropertyCoverageRequirement[],
    maxLabels: number
): PropertyCoverage {
    const labels = new Set(requirements.map(function (entry) {
        return entry.label;
    }));
    const phases = new Map<string, Map<string, number>>();
    let denominator = 0;
    function checkLimit(): void {
        if (labels.size > maxLabels) {
            throw new TypeError('Property coverage label limit exceeded.');
        }
    }
    checkLimit();
    return {
        trial(phase) {
            return trialCoverage(function observe(label) {
                labels.add(label);
                checkLimit();
            }, function commit(hits) {
                if ([ 'exploration', 'exhaustive' ].includes(phase)) {
                    denominator += 1;
                }
                const counts = phases.get(phase) ?? new Map<string, number>();
                phases.set(phase, countHits(counts, hits));
            });
        },
        snapshot() {
            return Object.freeze({
                denominator,
                requirements,
                phases: Object.freeze(Object.fromEntries(
                    Array.from(phases, function ([ phase, counts ]) {
                        return [ phase, Object.freeze(Object.fromEntries(counts)) ];
                    })
                ))
            });
        },
        unmet() {
            return requirements.filter(function unmet(entry) {
                const hits = (phases.get('exploration')?.get(entry.label) ?? 0) +
                    (phases.get('exhaustive')?.get(entry.label) ?? 0);
                return denominator === 0 || !meetsPercentage(hits, denominator, entry.minimumPercent);
            });
        }
    };
}
