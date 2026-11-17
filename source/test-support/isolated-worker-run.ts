import type { ResolvedRunInput } from '../run/run-input-resolution.ts';
import type { RunCommand } from '../run/run-types.ts';
import type { IsolatedRunOptions } from '../run/run-isolated-process.ts';
import type { RunOrchestratorDependencies } from '../run/run-orchestrator-dependencies.ts';
import { deterministicDiscoveredFile } from './deterministic-run-fixtures.ts';
import { defaultIntegrationProfile, defaultRunConfig, defaultRunRequest } from './run-command-factory.ts';
import {
    workerPoolOrchestration,
    workerOrchestrationFaults,
    type WorkerOrchestrationFaults
} from './worker-pool-orchestration.ts';

export type IsolatedWorkerFixture = {
    readonly command: RunCommand;
    readonly input: ResolvedRunInput;
    readonly options: IsolatedRunOptions;
    readonly dependencies: RunOrchestratorDependencies;
    readonly events: readonly string[];
};
const source = 'source/integration-tests/run/fixtures/passing.test.ts';
export function isolatedWorkerRun(
    faults: WorkerOrchestrationFaults,
    timed: boolean,
    history: boolean
): IsolatedWorkerFixture {
    const fixture = workerPoolOrchestration(faults, timed);
    const profile = defaultIntegrationProfile({
        execution: {
            processModel: 'worker-pool',
            assignmentPolicy: history ? 'duration-history-balanced' : 'case-count-balanced',
            scheduling: 'serial',
            maxWorkers: 1
        }
    });
    const config = defaultRunConfig({ profiles: { integration: profile } });
    const request = defaultRunRequest({ profile: 'integration', paths: [ source ] });
    const command: RunCommand = { cwd: '/project', config, engine: { kind: 'default' }, request };
    const input: ResolvedRunInput = {
        benchmarkPurpose: 'compare',
        benchmarkHost: null,
        benchmarkCalibration: null,
        benchmarkNormalization: null,
        config,
        engine: command.engine,
        files: [ deterministicDiscoveredFile('/project', source) ],
        profile,
        projectRoot: '/project',
        request
    };
    return {
        command,
        input,
        dependencies: fixture.dependencies,
        events: fixture.events,
        options: { record: null, baseline: null, source: { kind: 'configured-files' }, timing: fixture.options.timing }
    };
}
export function passingIsolatedWorkerRun(timed: boolean, history: boolean): IsolatedWorkerFixture {
    return isolatedWorkerRun(workerOrchestrationFaults, timed, history);
}
