import { createNodeRunOrchestratorDependencies } from './node-run-orchestrator-dependencies.entry-point.ts';
import { createCurrentProcessRunInput } from './current-process-run-input.entry-point.ts';
import { defaultRunEngine } from './default-run-engine.ts';
import { loadRunEngineModule, loadRunTestModules, runDiscovery } from './node-run-dependencies.entry-point.ts';
import { createCollectedExecutionSession } from './execution-session-collected.ts';
import { serveExecutionSessionHost } from './execution-session-host.ts';

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
await serveExecutionSessionHost({
    async receive() {
        return await new Promise(function (resolve) {
            process.once('message', resolve);
        });
    },
    async send(message) {
        await new Promise<void>(function (resolve, reject) {
            if (process.send === undefined) {
                reject(new Error('Execution host requires IPC.'));
                return;
            }
            process.send(message, function (error) {
                if (error === null) {
                    resolve();
                } else {
                    reject(error);
                }
            });
        });
    },
    disconnect() {
        process.disconnect?.();
    },
    create(options) {
        return createCollectedExecutionSession(options, dependencies);
    }
});
