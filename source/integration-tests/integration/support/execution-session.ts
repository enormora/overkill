import {
    orchestrator,
    type RunExecutionSessionOptions,
    type RunExecutionSession
} from '../../../packages/run/run.entry-point.ts';
import { collectedRunCommand } from '../../../test-support/collected-run-fixtures.ts';
import {
    createChildRun,
    readNativeEnvironment,
    type ChildRunFixture
} from '../../../test-support/supervised-child-fixture.ts';
import { loadRunTestModules } from '../../../run/node-run-dependencies.entry-point.ts';
import { createSupervisedRunCommand } from '../../../run/run-isolated-command.ts';
import { policyBaselineCommand } from '../../../run/frozen-run-policy.ts';

export const passingFiles = [ 'source/integration-tests/integration/fixtures/passing.test.ts' ] as const;

const lifecycleModule = new URL(
    '../fixtures/execution-session-lifecycle.test.ts',
    import.meta.url
);

export async function sessionOptions(
    processModel: 'in-process' | 'supervised-process',
    files: readonly string[]
): Promise<RunExecutionSessionOptions> {
    const command = collectedRunCommand();
    const profile = command.config.profiles.microtest;
    if (profile?.testFamily !== 'microtest') {
        throw new Error('Missing microtest fixture profile.');
    }
    const policy = await orchestrator.freezePolicy({
        moduleBoundary: null,
        source: { kind: 'memory' },
        command: {
            ...command,
            config: {
                ...command.config,
                profiles: {
                    microtest: {
                        ...profile,
                        execution: { processModel, scheduling: 'serial', maxConcurrency: 1 },
                        timeouts: { collectionMilliseconds: 30_000, hardMilliseconds: 30_000, softMilliseconds: 30_000 }
                    }
                }
            },
            request: { ...command.request, paths: files }
        }
    });
    return {
        command: {
            kind: 'frozen-policy',
            policy,
            invocation: { seed: { value: 42n }, selection: { kind: 'all' } },
            reporting: { outputRenderer: command.config.outputRenderer, reporters: [] }
        },
        lifecycle: {
            moduleUrl: lifecycleModule.href,
            exportName: 'createSessionLifecycle'
        },
        environment: 'profile-default'
    };
}

export async function createNativeSessionChild(data: string): Promise<ChildRunFixture> {
    const options = await sessionOptions('supervised-process', passingFiles);
    const { policy } = options.command;
    const command = createSupervisedRunCommand(
        policyBaselineCommand(policy),
        {
            ...policy.profile,
            reporters: null,
            baselines: { adapters: [], directory: 'test-baselines', snapshots: false, stale: 'fail' }
        },
        policy.files,
        { projectRoot: process.cwd(), source: { kind: 'frozen-policy', policy }, normalization: null }
    );
    return createChildRun({
        command: { ...command, kind: 'run-session', policy, session: { lifecycle: options.lifecycle, data } },
        assignment: {
            implementations: null,

            kind: 'assign',
            attachmentEndpoint: null,
            assignedCases: [ {
                file: passingFiles[0],
                suite: [ 'fixture' ],
                title: 'passes',
                params: null
            } ]
        },
        async discoverRunFiles() {
            return policy.files;
        },
        loadRunTestModules,
        readEnvironment: readNativeEnvironment
    });
}

export function createScheduledSession(
    options: RunExecutionSessionOptions,
    scheduling: 'concurrent' | 'serial',
    maxConcurrency: number
): RunExecutionSession {
    const { policy } = options.command;
    return orchestrator.createExecutionSession({
        ...options,
        command: {
            ...options.command,
            policy: {
                ...policy,
                profile: { ...policy.profile, execution: { ...policy.profile.execution, scheduling, maxConcurrency } },
                request: { ...policy.request, execution: { mode: 'profile-default' } }
            }
        }
    });
}
