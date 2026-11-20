import { type TestScope, suite as authoredSuite, test as authoredTest } from '@overkill-dev/test';

import { defineResource, type AnyResourceDefinition } from './resources.ts';
import {
    withResourceChecks,
    createSupervisedResourceCheckSession,
    type ResourceCheckInstaller,
    type ResourceCheckSession,
    type ResourceCheckInstallationContext
} from './resource-checks.ts';

function installationSession(install: ResourceCheckInstaller<AnyResourceDefinition>): ResourceCheckSession {
    const owner = defineResource({
        name: 'owner',
        scope: 'per-case',
        requirements: [],
        acquire() {
            return 42;
        },
        dispose: null
    });
    return createSupervisedResourceCheckSession(withResourceChecks(owner, install), 42, {
        kind: 'standalone',
        stop() {
            return undefined;
        }
    }, {
        now() {
            return 0;
        },
        async run(operation, signal) {
            return await operation(signal);
        }
    });
}
function finish(): void {
    return undefined;
}
export const testNode = authoredSuite('resource observation installation admission', [
    authoredTest('rejects observation errors recorded during installation', async function (scope: TestScope) {
        const session = installationSession(function (context) {
            context.ledger.error({ kind: 'lifetime' }, null, new Error('installation evidence failed'));
            return {
                prepare: finish,
                finalize() {
                    return { kind: 'complete' };
                }
            };
        });
        await scope.assert.rejects(async function () {
            await session.install(scope.signal);
        }, { message: 'Resource observation reported installation errors.' });
        scope.assert.throws(session.assertAdmitted, { message: 'Resource observation is stopped.' });
        return scope.assert.collect();
    }),
    ...[ 'prepare', 'finalize' ].map(function (method) {
        return authoredTest(`rejects malformed ${method} observer callbacks`, async function (scope: TestScope) {
            const session = installationSession(function () {
                const observation = {
                    prepare: finish,
                    finalize() {
                        return { kind: 'complete' as const };
                    }
                };
                Reflect.set(observation, method, 42);
                return observation;
            });
            await scope.assert.rejects(async function () {
                await session.install(scope.signal);
            }, { message: 'Resource observers require preparation and finalization callbacks.' });
            scope.assert.throws(session.assertAdmitted, { message: 'Resource observation is stopped.' });
            return scope.assert.collect();
        });
    }),
    authoredTest('retains cleanup failures registered after closure', async function (scope: TestScope) {
        const installed = Promise.withResolvers<ResourceCheckInstallationContext<AnyResourceDefinition>>();
        const session = installationSession(function (context) {
            installed.resolve(context);
            return {
                prepare: finish,
                finalize() {
                    return { kind: 'complete' };
                }
            };
        });
        await session.install(scope.signal);
        const context = await installed.promise;
        await session.close(finish);
        const failure = new Error('late cleanup failed');
        context.cleanup.defer(function () {
            throw failure;
        });
        await session.close(finish);
        scope.assert.equal(session.snapshots()[0]?.errors[0]?.cause, failure);
        return scope.assert.collect();
    })
]);
