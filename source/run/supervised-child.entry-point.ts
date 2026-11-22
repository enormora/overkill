import { createClock } from '@enormora/clock';
import type { SupervisedChildCommand, SupervisedRunCommand } from './supervised-protocol.ts';
import {
    cancellationSignal,
    disconnect,
    flushSupervisedMessages,
    observeAnalysisCancellation,
    ownedMessageListeners,
    receiveAssignment,
    receiveCommand,
    send
} from './supervised-child-ipc.ts';
import { withAnalysisSignal } from './analysis-deadline.ts';
import { readProcessEnvironment, readWebStorage } from './node-host-readers.ts';
import {
    loadRunEngineModule,
    loadRunTestModules,
    runDiscovery
} from './node-run-dependencies.entry-point.ts';
import {
    observeProcessIpcListeners
} from './node-process-policy-observation.ts';
import { createNodeProcessUsageTracker } from './process-usage.ts';
import { runSupervisedChild } from './supervised-child.ts';

function validatePermissionHost(command: SupervisedChildCommand): void {
    if (command.capabilityRestrictions.mode === 'disabled') {
        return;
    }

    if (!process.execArgv.includes('--permission')) {
        throw new Error('Restricted microtest child started without --permission.');
    }

    if (process.execArgv.includes('--permission-audit')) {
        throw new Error('Restricted microtest child must not use --permission-audit.');
    }
}

function dropBodyReadPermission(command: SupervisedRunCommand): void {
    if (command.capabilityRestrictions.mode === 'enabled') {
        const drop: unknown = Reflect.get(process.permission, 'drop');

        if (typeof drop === 'function') {
            Reflect.apply(drop, process.permission, [ 'fs.read' ]);
        }
    }
}

const stopObservingCancellation = observeAnalysisCancellation();
try {
    await withAnalysisSignal(cancellationSignal, async function runChild() {
        await runSupervisedChild(
            {
                disconnect,
                flush: flushSupervisedMessages,
                discoverRunFiles: runDiscovery.discoverRunFiles,
                dropBodyReadPermission,
                observeIpcListeners(record) {
                    return observeProcessIpcListeners(process, record, ownedMessageListeners);
                },
                observeProcessExit() {
                    return function stopObservingChildExit() {
                        return undefined;
                    };
                },
                readEnvironment() {
                    return readProcessEnvironment(process);
                },
                readStorage(name) {
                    return readWebStorage(globalThis, name);
                },
                loadRunEngineModule,
                loadRunTestModules,
                receiveAssignment,
                receiveCommand,
                send,
                setExitCode(code) {
                    process.exitCode = code;
                },
                validatePermissionHost
            },
            {
                createProcessUsageTracker: createNodeProcessUsageTracker,
                createClock,
                readActiveResourceTypes: process.getActiveResourcesInfo
            }
        );
    });
} finally {
    stopObservingCancellation();
}
