import type {
    TestBody,
    PropertyExecutionHost,
    PropertyInvocationEvidence,
    PropertyInvocationSummary
} from '../packages/engine/engine.entry-point.ts';
import { propertyReplayWitness } from '../engine/property-execution-host.ts';
import { propertySeed } from './property-random.ts';
import type { PropertyInvocationContext } from './property-execution-result.ts';
import { propertyTrialPosition, type PropertyWork } from './property-work.ts';
import type { PropertyCoverage } from './property-coverage.ts';

type PropertyReporting = {
    readonly host: PropertyExecutionHost;
    readonly publish: (status: PropertyInvocationSummary['status'], exhaustive: number | null) => Promise<void>;
};
export function createPropertyReporting(
    context: PropertyInvocationContext,
    work: PropertyWork,
    coverage: PropertyCoverage,
    diagnostics: PropertyInvocationEvidence['diagnostics']
): PropertyReporting {
    let domainSize: number | null = null;
    const witness = propertyReplayWitness(context.host);
    const witnessSeed = witness === null ? null : witness.seed;
    let last: PropertyInvocationEvidence = {
        summary: null,
        confirmedWitness: null,
        shrinkStatus: null,
        identity: context.identity,
        original: null,
        retained: null,
        diagnostics: []
    };
    function summary(status: PropertyInvocationSummary['status']): PropertyInvocationSummary {
        const accounting = work.snapshot();
        return {
            status,
            trial: propertyTrialPosition(work),
            runSeed: context.host.seed.toString(),
            propertySeed: propertySeed(context.host, context.identity),
            witnessSeed,
            seedVersion: 'property-v1',
            accounting,
            coverage: coverage.snapshot(),
            exhaustive: domainSize === null
                ? null
                : {
                    domainSize,
                    executed: accounting
                        .phases
                        .exhaustive
                        .executed,
                    traversal: status === 'completed' || status === 'coverage-unmet' ? 'complete' : 'incomplete'
                }
        };
    }
    const host = {
        ...context.host,
        async recordEvidence(evidence: PropertyInvocationEvidence) {
            last = evidence;
            await context.host.recordEvidence({
                ...evidence,
                summary: evidence.summary ?? summary('in-progress'),
                diagnostics: [ ...diagnostics, ...evidence.diagnostics ]
            });
        }
    };

    return {
        async publish(status: PropertyInvocationSummary['status'], exhaustive: number | null) {
            domainSize = exhaustive ?? domainSize;
            const current = summary(status);
            await host.recordEvidence({ ...last, summary: current });
        },
        host: {
            ...host,
            async evaluateTrial(body: TestBody, signal: AbortSignal) {
                return await host.evaluateTrial(async function evaluateObservedTrial(scope) {
                    work.execute();
                    await host.recordEvidence({ ...last, summary: summary('in-progress') });
                    return await body(scope);
                }, signal);
            }
        }
    };
}
