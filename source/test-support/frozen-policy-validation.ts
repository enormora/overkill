import { policyBaselineCommand } from '../run/frozen-run-policy.ts';
import type { FrozenMicrotestPolicy } from '../run/run-types.ts';
import type { RunInputResolutionDependencies } from '../run/run-input-resolution.ts';
import type { loadConfig } from '../packages/run/config.entry-point.ts';
import { frozenMicrotestPolicy } from './frozen-microtest-policy.ts';

type FrozenPolicyValidationFixture = {
    readonly policy: FrozenMicrotestPolicy;
    readonly dependencies: Pick<RunInputResolutionDependencies, 'discoverRunFilesWithProjectRoot'>;
    readonly load: typeof loadConfig;
    readonly events: readonly string[];
};
export async function frozenPolicyValidation(): Promise<FrozenPolicyValidationFixture> {
    const original = await frozenMicrotestPolicy();
    const policy: FrozenPolicyValidationFixture['policy'] = {
        ...original,
        source: {
            kind: 'config-file',
            request: { cwd: '/project', configPath: 'overkill.config.js' },
            resolvedPath: '/project/overkill.config.js'
        }
    };
    const command = policyBaselineCommand(policy);
    const events: string[] = [];
    return {
        policy,
        events,
        dependencies: {
            async discoverRunFilesWithProjectRoot() {
                events.push('discover');
                return { projectRoot: policy.projectRoot, files: policy.files };
            }
        },
        async load() {
            events.push('load');
            return { ...command.config, configPath: '/project/overkill.config.js' };
        }
    };
}
