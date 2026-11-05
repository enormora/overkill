import type { PropertyInvocationEvidence, PropertyInvocationSummary } from '../engine/property-failure-evidence.ts';
import { formatSerializedValue } from './serialized-value-rendering.ts';

const percentScale = 100;

function coverageLines(summary: PropertyInvocationSummary): readonly string[] {
    return [
        ...summary.coverage.requirements.map(function requirement(entry) {
            const hits = summary.coverage.eligibleHits[entry.label] ?? 0;
            const { denominator } = summary.coverage;
            const percent = denominator === 0 ? 'unavailable' : `${hits * percentScale / denominator}%`;
            return `  Required input coverage ${entry.label}: ${hits}/${denominator} (${percent}), ` +
                `minimum ${entry.minimumPercent}%`;
        }),
        ...Object.entries(summary.coverage.phases).map(function coverage([ phase, hits ]) {
            return `  Input coverage ${phase}: ${JSON.stringify(hits)} / ` +
                `${
                    summary.coverage.phaseDenominators[phase] ?? 0
                }; eligible denominator=${summary.coverage.denominator}`;
        })
    ];
}

export function formatPropertySummary(invocation: PropertyInvocationEvidence): readonly string[] {
    const { summary } = invocation;
    if (summary === null) {
        return [];
    }
    const phases = Object
        .entries(summary.accounting.phases)
        .filter(function observed([ , counts ]) {
            return counts.executed > 0 || counts.rejected > 0;
        })
        .map(function phase([ name, counts ]) {
            return `${name}=${counts.executed} rejected=${counts.rejected}`;
        });
    return [
        `Property ${invocation.identity}: ${summary.status} run seed=${summary.runSeed} ` +
        `property seed=${summary.propertySeed}`,
        `  Phases: ${phases.join(', ')}; work=${summary.accounting.workConsumed}`,
        ...coverageLines(summary),
        ...invocation.retained === null
            ? []
            : [ `  Shrunk counterexample: ${formatSerializedValue(invocation.retained.input)}` ],
        ...summary.witnessSeed === null ? [] : [ `  Witness seed=${summary.witnessSeed}` ],
        ...summary.exhaustive === null ? [] : [
            `  Exhaustive traversal ${summary.exhaustive.traversal}: ` +
            `${summary.exhaustive.executed}/${summary.exhaustive.domainSize}`
        ]
    ];
}
