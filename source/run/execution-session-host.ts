import type { JsonValue } from 'type-fest';
import { createPlainOutputRenderer } from '../engine/reporter-output.ts';
import { createNodeRunOrchestratorDependencies } from './node-run-orchestrator-dependencies.ts';
import { createCurrentProcessRunInput } from './current-process-run-input.ts';
import { defaultRunEngine } from './default-run-engine.ts';
import { loadRunEngineModule, loadRunTestModules, runDiscovery } from './node-run-dependencies.entry-point.ts';
import { createCollectedExecutionSession } from './execution-session-collected.ts';
import { executionHostRequestSchema, executionReplySchema } from './execution-session-schema.ts';
import { parseFrozenMicrotestPolicy } from './frozen-run-policy.ts';

async function checkpoint(data: JsonValue): Promise<void> {
    await new Promise<void>(function (resolve, reject) {
        if (process.send === undefined) {
            reject(new Error('Execution host requires IPC.'));
            return;
        }
        process.send({ kind: 'execution-checkpoint', data }, function (error) {
            if (error === null) {
                resolve();
            } else {
                reject(error);
            }
        });
    });
}

function unsupportedIsolatedDispatch(): never {
    throw new Error('Fresh invocation hosts require an in-process profile.');
}
const dependencies = createNodeRunOrchestratorDependencies(createCurrentProcessRunInput(defaultRunEngine, {
    discoverRunFilesWithProjectRoot: runDiscovery.discoverRunFilesWithProjectRoot,
    loadRunEngineModule,
    loadRunTestModules,
    startSupervisedChild: unsupportedIsolatedDispatch,
    startWorkerPoolHost: unsupportedIsolatedDispatch
}));
const input = await new Promise<ReturnType<typeof executionHostRequestSchema.parse>>(function (resolve, reject) {
    process.once('message', function (message) {
        try {
            resolve(executionHostRequestSchema.parse(message));
        } catch (error: unknown) {
            reject(error instanceof Error ? error : new Error('Invalid execution host request.', { cause: error }));
        }
    });
});
const environment = createCollectedExecutionSession({
    command: {
        kind: 'frozen-policy',
        policy: parseFrozenMicrotestPolicy(input.policy),
        invocation: { seed: input.seed, selection: input.selection },
        reporting: { outputRenderer: createPlainOutputRenderer(), reporters: [] }
    },
    environment: 'profile-default',
    lifecycle: input.transport.lifecycle
}, dependencies);
const cancellation = new AbortController();
const reply = executionReplySchema.parse(
    await environment.execute({
        transport: input.transport,
        timeoutMilliseconds: input.timeoutMilliseconds,
        checkpoint,
        signal: cancellation.signal
    })
);
await new Promise<void>(function (resolve, reject) {
    if (process.send === undefined) {
        reject(new Error('Execution host requires IPC.'));
        return;
    }
    process.send(reply, function (error) {
        if (error === null) {
            resolve();
        } else {
            reject(error);
        }
    });
});
process.disconnect?.();
