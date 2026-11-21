import { channel } from 'node:diagnostics_channel';
import { suite, test } from '@overkill-dev/test';
import { createRuntimeCapabilityPolicy } from '../../../run/capability-policy.ts';
import { runWithReporterOutputScopeNow } from '../../../engine/reporter-output-scope.ts';

function ignoreProcessObservation(): () => void {
    return function stopUnusedObservation() {
        return undefined;
    };
}

export const testNode = suite('Reporter console capability policy', [
    test(
        'keeps console violations separate from test-policy errors',
        async function (scope) {
            const environment = {};
            const policy = createRuntimeCapabilityPolicy({
                dependencies: {
                    observeIpcListeners: ignoreProcessObservation,
                    observeProcessExit: ignoreProcessObservation,
                    readEnvironment() {
                        return environment;
                    },
                    readStorage() {
                        return null;
                    }
                },
                observedStderr: false,
                observedStdout: false
            });
            scope.cleanup(function stopReporterPolicy() {
                policy.takeRunErrors();
            });
            const result = await policy.runLoad(async function reportWithNativePolicy() {
                return runWithReporterOutputScopeNow([], function deniedReporterConsole(method) {
                    return `blocked ${method}`;
                }, function publishReporterDiagnostic() {
                    channel('console.log').publish({});
                });
            });
            scope.assert.deepEqual(result.violations, [ 'blocked log' ]);
            scope.assert.deepEqual(policy.takeRunErrors(), []);
            return scope.assert.collect();
        }
    )
]);
