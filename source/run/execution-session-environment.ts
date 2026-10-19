import { runFreshExecutionSession } from './execution-session-process.ts';
import { runSupervisedExecutionSession } from './execution-session-supervised.ts';
import { createCollectedExecutionSession } from './execution-session-collected.ts';
import type { ExecutionSessionEnvironment } from './execution-session-runtime-types.ts';
import type { RunExecutionSessionOptions } from './run-types.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';

export function createExecutionSessionEnvironment(
    options: RunExecutionSessionOptions,
    dependencies: RunOrchestratorDependencies
): ExecutionSessionEnvironment {
    if (options.command.policy.profile.execution.processModel === 'supervised-process') {
        return {
            lifetime: 'fresh',
            async execute(call) {
                return await runSupervisedExecutionSession(options, dependencies, call);
            }
        };
    }
    if (options.environment === 'fresh-invocation') {
        return {
            lifetime: 'fresh',
            async execute(call) {
                return await runFreshExecutionSession(
                    options.command,
                    call.transport,
                    call.timeoutMilliseconds,
                    call
                );
            }
        };
    }
    return createCollectedExecutionSession(options, dependencies);
}
