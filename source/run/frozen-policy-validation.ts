import { isDeepStrictEqual } from 'node:util';
import { loadConfig } from '../packages/run/config.entry-point.ts';
import { freezeRunPolicy } from './freeze-run-policy.ts';
import type { FrozenMicrotestPolicy } from './run-types.ts';
import { policyBaselineCommand } from './frozen-run-policy.ts';
import type { RunInputResolutionDependencies } from './run-input-resolution.ts';
import { resolveProcessUsagePolicy, resolveRunScheduling, resolveTimingCollection } from './run-profile-facts.ts';
import { RunResolutionError } from './run-errors.ts';

function policyFacts(policy: FrozenMicrotestPolicy): Readonly<Record<string, unknown>> {
    const command = policyBaselineCommand(policy);
    const profile = { ...policy.profile, reporters: null };
    return {
        moduleBoundary: policy.moduleBoundary,
        source: policy.source,
        discovery: {
            cwd: policy.cwd,
            root: policy.projectRoot,
            files: policy.files,
            declarations: policy.profile.files
        },
        loader: policy.loader,
        selection: {
            paths: policy.request.paths,
            profile: policy.request.profile,
            selection: policy.request.selection,
            shard: policy.request.shard,
            order: policy.request.order
        },
        permissions: policy.request.capabilityRestrictions,
        execution: {
            engine: policy.engine,
            processModel: policy.profile.execution.processModel,
            scheduling: resolveRunScheduling(command.request, profile),
            maxConcurrency: policy.profile.execution.maxConcurrency,
            capture: policy.request.capture,
            timeouts: policy.profile.timeouts,
            timingCollection: resolveTimingCollection(command.request, profile),
            coverage: policy.request.coverage,
            coveragePolicy: policy.request.coverage ? policy.profile.coverage : null,
            baselineUpdateMode: policy.request.baselineUpdateMode,
            debug: policy.request.debug
        },
        processUsage: resolveProcessUsagePolicy(command.request, profile),
        runtimeStateDir: policy.runtimeStateDir
    };
}

function revalidationFailure(error: unknown): string {
    return error instanceof Error && error.cause instanceof Error
        ? `${String(error)}: ${String(error.cause)}`
        : String(error);
}

async function reevaluatePolicy(
    policy: FrozenMicrotestPolicy,
    dependencies: RunInputResolutionDependencies
): Promise<FrozenMicrotestPolicy> {
    if (policy.source.kind === 'memory') {
        return policy;
    }
    try {
        const config = await loadConfig(policy.source.request);
        return await freezeRunPolicy({
            moduleBoundary: policy.moduleBoundary,
            command: { ...policyBaselineCommand(policy), config },
            source: { ...policy.source, resolvedPath: config.configPath }
        }, dependencies);
    } catch (error: unknown) {
        throw new RunResolutionError(
            `Frozen policy revalidation failed: ${revalidationFailure(error)}`,
            { cause: error },
            'invalid-request'
        );
    }
}

export async function validateFrozenPolicySource(
    policy: FrozenMicrotestPolicy,
    dependencies: RunInputResolutionDependencies
): Promise<void> {
    const actual = await reevaluatePolicy(policy, dependencies);
    if (actual === policy) {
        return;
    }
    const expectedFacts = policyFacts(policy);
    const actualFacts = policyFacts(actual);
    const conflicts = Object.keys(expectedFacts).filter(function changedFact(field) {
        return !isDeepStrictEqual(expectedFacts[field], actualFacts[field]);
    });
    if (conflicts.length > 0) {
        throw new RunResolutionError(`Frozen policy changed: ${conflicts.join(', ')}.`, undefined, 'invalid-request');
    }
}
