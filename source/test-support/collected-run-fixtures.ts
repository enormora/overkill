import { orchestrator, type CollectedRun, type RunCommand } from '../packages/run/run.entry-point.ts';
import type { LifecycleFixtureState } from '../integration-tests/run/fixtures/collected-lifecycle.test.ts';
import { defaultMicrotestProfile, defaultRunConfig, defaultRunRequest } from './run-command-factory.ts';

export function collectedRunCommand(): RunCommand {
    return {
        config: defaultRunConfig({
            profiles: {
                microtest: defaultMicrotestProfile({ execution: { processModel: 'in-process', scheduling: 'serial' } })
            }
        }),
        cwd: process.cwd(),
        engine: { kind: 'default' },
        request: defaultRunRequest({
            paths: [ 'source/integration-tests/run/fixtures/collected-lifecycle.test.ts' ],
            order: 'plan'
        })
    };
}

export async function collectLifecycleRun(command: RunCommand): Promise<{
    readonly collected: CollectedRun;
    readonly state: LifecycleFixtureState;
}> {
    const initialized = await orchestrator.initialize(command);
    const collected = await initialized.collect();
    const { state } = await import('../integration-tests/run/fixtures/collected-lifecycle.test.ts');
    state.calls.length = 0;
    state.scopes.length = 0;
    state.cleanupCount = 0;
    state.gate = null;
    state.mode = 'pass';
    state.notifyStarted = function ignoreStartedCase() {
        return undefined;
    };
    return { collected, state };
}
