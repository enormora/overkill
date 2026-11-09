import type { MicrotestProfileConfig } from '../config/types.ts';
import { createPlainOutputRenderer } from '../engine/reporter-output.ts';
import { normalizeProfileFiles } from '../config/profile-normalization.ts';
import type {
    FrozenMicrotestPolicy,
    FrozenRunCommand,
    RunCommand,
    RunSelection
} from './run-types.ts';
import { frozenMicrotestPolicySchema } from './frozen-run-policy-schema.ts';
import { freezeValue } from './run-support.ts';
import { validateRunInput } from './run-validation.ts';
import { resolveProcessUsagePolicy } from './run-profile-facts.ts';
import { validateFrozenPolicyOrigins } from './frozen-policy-origins.ts';

export function intersectSelection(baseline: RunSelection, selected: RunSelection): RunSelection {
    if (baseline.kind === 'none' || selected.kind === 'none') {
        return { kind: 'none' };
    }
    if (baseline.kind === 'all') {
        return selected;
    }
    if (selected.kind === 'all') {
        return baseline;
    }
    return { kind: 'filter', filter: { kind: 'all', filters: [ baseline.filter, selected.filter ] } };
}

export function frozenPolicyProfile(policy: FrozenMicrotestPolicy): MicrotestProfileConfig {
    return {
        ...policy.profile,
        reporters: null,
        baselines: { adapters: [], directory: 'test-baselines', snapshots: false, stale: 'fail' }
    };
}

export function frozenPolicyCommand(input: FrozenRunCommand): RunCommand {
    const { policy, invocation, reporting } = input;
    const selection = intersectSelection(policy.request.selection, invocation.selection);

    return {
        config: {
            ...reporting,
            history: policy.history,
            loader: policy.loader,
            profiles: {
                [policy.request.profile]: frozenPolicyProfile(policy)
            },
            runtimeStateDir: policy.runtimeStateDir
        },
        cwd: policy.cwd,
        engine: policy.engine,
        request: { ...policy.request, seed: invocation.seed, selection }
    };
}

export function policyBaselineCommand(policy: FrozenMicrotestPolicy): RunCommand {
    return frozenPolicyCommand({
        kind: 'frozen-policy',
        policy,
        invocation: { seed: { value: null }, selection: { kind: 'all' } },
        reporting: { outputRenderer: createPlainOutputRenderer(), reporters: [] }
    });
}

export function parseFrozenMicrotestPolicy(value: unknown): FrozenMicrotestPolicy {
    const policy = frozenMicrotestPolicySchema.parse(value);
    validateFrozenPolicyOrigins(policy);
    const command = policyBaselineCommand(policy);
    validateRunInput(command);
    resolveProcessUsagePolicy(command.request, frozenPolicyProfile(policy));
    normalizeProfileFiles(policy.profile.files ?? undefined);
    return freezeValue(policy);
}
