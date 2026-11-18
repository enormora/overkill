import { type DeterministicClock, createDeterministicClock } from '@enormora/clock';

import {
    type MutationRunnerLifecycle,
    createMutationRunnerLifecycle
} from '../packages/stryker-runner/mutation-runner-lifecycle.ts';
import type {
    ReadyMutationRunner,
    RunnerInitialization
} from '../packages/stryker-runner/mutation-runner-initialization.ts';

type MutationRunnerFixture = {
    readonly clock: DeterministicClock;
    readonly calls: readonly string[];
    readonly inputs: readonly RunnerInitialization[];
    readonly runner: ReadyMutationRunner;
    readonly lifecycle: MutationRunnerLifecycle;
};
export function mutationRunnerRuntime(): MutationRunnerFixture {
    const clock = createDeterministicClock({ initialUnixEpochMicroseconds: 0n });
    const calls: string[] = [];
    const inputs: RunnerInitialization[] = [];
    const runner: ReadyMutationRunner = {
        root: '/project',
        diagnostics: {
            mode: 'off',
            directory: '/project/diagnostics',
            root: '/project',
            campaign: 'campaign',
            seed: '42',
            profile: 'unit'
        },
        execution: {
            environmentLifetime: 'reused',
            admitEnvironment() {
                return undefined;
            },
            async run() {
                return { kind: 'timeout', artifacts: [], data: null };
            },
            async dispose() {
                calls.push('execution.dispose');
            }
        },
        client: {
            async request(request) {
                calls.push(request.kind);
                return { kind: 'accepted' };
            },
            dispose() {
                calls.push('client.dispose');
            },
            async expireRequests() {
                calls.push('expire');
            }
        }
    };
    async function initialize(input: RunnerInitialization): Promise<ReadyMutationRunner> {
        calls.push('initialize');
        inputs.push(input);
        input.connected(runner.client);
        return runner;
    }
    const lifecycle = createMutationRunnerLifecycle({}, {}, {
        info() {
            return undefined;
        }
    }, { clock, initialize });
    return { clock, calls, inputs, runner, lifecycle };
}
