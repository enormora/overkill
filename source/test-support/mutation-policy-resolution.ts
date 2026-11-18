import {
    normalizeConfig,
    type FreezePolicyInput,
    type FrozenMicrotestPolicy,
    type FileModuleBoundary
} from '../packages/run/run.entry-point.ts';
import type { ConfigLoadRequest, LoadedConfig } from '../config/config-loader.ts';
import type { MutationPolicyRuntime } from '../packages/stryker-runner/mutation-policy-resolver.ts';
import type { MutationPolicyRequest } from '../packages/stryker-runner/mutation-policy-protocol.ts';
import { testDouble } from '../packages/test/test.entry-point.ts';
import { frozenMicrotestPolicy } from './frozen-microtest-policy.ts';

type ExcludedPolicyFiles = { readonly paths: readonly string[]; readonly role: string; };
type MutationPolicyFixture = {
    readonly runtime: MutationPolicyRuntime;
    readonly request: MutationPolicyRequest;
    readonly policy: FrozenMicrotestPolicy;
    readonly loaded: readonly ConfigLoadRequest[];
    readonly frozen: readonly FreezePolicyInput[];
    readonly excluded: readonly ExcludedPolicyFiles[];
    readonly boundaries: readonly (FileModuleBoundary | null)[];
};
export async function mutationPolicyResolution(
    configPath: string | null,
    failure: unknown
): Promise<MutationPolicyFixture> {
    const policy = await frozenMicrotestPolicy();
    const config: LoadedConfig = {
        ...normalizeConfig({
            profiles: { unit: { testFamily: 'microtest', execution: { processModel: 'in-process' } } }
        }),
        configPath
    };
    const loaded: ConfigLoadRequest[] = [];
    const frozen: FreezePolicyInput[] = [];
    const excluded: ExcludedPolicyFiles[] = [];
    const boundaries: (FileModuleBoundary | null)[] = [];
    return {
        policy,
        loaded,
        frozen,
        excluded,
        boundaries,
        request: { kind: 'resolve-policy', cwd: '/project', sandbox: null, settings: { seed: '42', profile: 'unit' } },
        runtime: {
            async load(request) {
                loaded.push(request);
                if (failure !== null) {
                    return testDouble.throws<() => LoadedConfig>(failure)();
                }
                return config;
            },
            async freeze(input) {
                frozen.push(input);
                return policy;
            },
            async boundary(value, operation) {
                boundaries.push(value);
                return await operation();
            },
            async exclude(_sandbox, paths, role) {
                excluded.push({ paths, role });
            }
        }
    };
}
