import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runIfMain } from '#test-runner';
import { z } from 'zod/v4';
import {
    createRoot,
    createTestCase,
    createTestPlan,
    defineBodyReference,
    type TestPlan
} from '../packages/engine/engine.entry-point.ts';
import { createTemporaryDirectoryResource, startResources } from '../packages/resources/resources.entry-point.ts';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { prepareBodyReferences } from '../engine/body-reference-plan.ts';
import { withWorkerImplementations, closeWorkerImplementations } from './worker-implementation-plan.ts';

type ImportProbe = (module: string) => Promise<unknown>;
const probeKey = '@overkill-dev/test/workerImplementationImports';
const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
function importProbe(): ImportProbe {
    return z
        .custom<ImportProbe>(function callable(value) {
            return typeof value === 'function';
        })
        .parse(Reflect.get(globalThis, probeKey));
}
async function referencePlan(root: string, name: string, signal: AbortSignal): Promise<TestPlan> {
    const url = pathToFileURL(join(root, `${name}.mjs`)).href;
    await writeFile(
        join(root, `${name}.mjs`),
        [
            `globalThis[${JSON.stringify(probeKey)}] = (module) => import(module);`,
            "export const body = { version:'1', implementation(scope) { return scope.assert.collect(); } };"
        ]
            .join('\n')
    );
    await writeFile(join(root, 'late.mjs'), 'export const value = 42;');
    const body = defineBodyReference({
        module: { moduleUrl: url, exportName: 'body' },
        realm: 'host',
        version: '1',
        input: null,
        dynamicModules: [ { moduleUrl: pathToFileURL(join(root, 'late.mjs')).href, exportName: 'value' } ],
        parseInput() {
            return null;
        }
    });
    return await prepareBodyReferences(
        createTestPlan(
            createRoot({ ...metadata, title: name, children: [ createTestCase({ ...metadata, title: name, body }) ] })
        ),
        { projectRoot: root },
        signal
    );
}
async function project(scope: TestScope, use: (root: string) => Promise<void>): Promise<void> {
    await using temporary = await startResources({
        resources: { directory: createTemporaryDirectoryResource('directory') },
        signal: scope.signal
    });
    try {
        await use(temporary.context.directory.path);
    } finally {
        Reflect.deleteProperty(globalThis, probeKey);
        await closeWorkerImplementations(temporary.context.directory.path);
    }
}
export const testNode = suite('worker implementation lifetimes', [
    test('keeps older scopes usable when a later assignment fails', async function (scope) {
        await project(scope, async function verify(root) {
            const older = await referencePlan(root, 'retained', scope.signal);
            await withWorkerImplementations(root, older, async function execute() {
                return undefined;
            });
            const olderProbe = importProbe();
            const newer = await referencePlan(root, 'rejected', scope.signal);
            await scope.assert.rejects(async function failedAssignment() {
                await withWorkerImplementations(root, newer, async function execute() {
                    throw new Error('later assignment failed');
                });
            }, { message: 'later assignment failed' });
            scope.assert.equal(z.object({ value: z.number() }).parse(await olderProbe('./late.mjs')).value, 42);
            await closeWorkerImplementations(root);
            await scope.assert.rejects(async function afterClose() {
                await olderProbe('./late.mjs');
            }, { message: 'Implementation delivery is closed.' });
        });
        return scope.assert.collect();
    }),
    test('preserves work and cleanup failures together', async function (scope: TestScope) {
        const primary = new Error('work failed');
        await project(scope, async function verify(root) {
            const plan = await referencePlan(root, 'cleanup-failure', scope.signal);
            let failure: unknown = null;
            try {
                await withWorkerImplementations(root, plan, async function execute() {
                    await scope.assert.rejects(async function deniedImport() {
                        await importProbe()('./outside.mjs');
                    }, { message: 'Implementation import is outside the frozen graph: ./outside.mjs' });
                    throw primary;
                });
            } catch (error: unknown) {
                failure = error;
            }
            scope.require.instanceOf(failure, AggregateError);
            scope.assert.equal(failure.message, 'Implementation execution and cleanup failed.');
            scope.assert.equal(failure.errors.length, 2);
            scope.assert.equal(failure.errors[0], primary);
            scope.require.instanceOf(failure.errors[1], AggregateError);
        });
        return scope.assert.collect();
    }),
    test('retains a work failure when shutdown already closed its scope', async function (scope) {
        await project(scope, async function verify(root) {
            const plan = await referencePlan(root, 'closed-during-work', scope.signal);
            await scope.assert.rejects(async function shutdownFailure() {
                await withWorkerImplementations(root, plan, async function execute() {
                    await closeWorkerImplementations(root);
                    throw new Error('work interrupted after shutdown');
                });
            }, { message: 'work interrupted after shutdown' });
        });
        return scope.assert.collect();
    }),
    test('closes a newly admitted scope when work fails', async function (scope) {
        await project(scope, async function verify(root) {
            const plan = await referencePlan(root, 'failed', scope.signal);
            await scope.assert.rejects(async function failedWork() {
                return await withWorkerImplementations(root, plan, async function execute() {
                    throw new Error('work failed');
                });
            }, { message: 'work failed' });
            const probe = importProbe();
            await scope.assert.rejects(async function lateImport() {
                return await probe('./late.mjs');
            }, { message: 'Implementation delivery is closed.' });
            await closeWorkerImplementations(root);
        });
        return scope.assert.collect();
    }),
    test('closes every scope when one reports a loader failure', async function (scope) {
        await project(scope, async function verify(root) {
            const older = await referencePlan(root, 'older', scope.signal);
            await withWorkerImplementations(root, older, async function execute() {
                return undefined;
            });
            const olderProbe = importProbe();
            const newer = await referencePlan(root, 'newer', scope.signal);
            await withWorkerImplementations(root, newer, async function execute() {
                const probe = importProbe();
                await scope.assert.rejects(async function undeclaredImport() {
                    return await probe('./outside.mjs');
                }, { message: 'Implementation import is outside the frozen graph: ./outside.mjs' });
            });
            await scope.assert.rejects(async function close() {
                await closeWorkerImplementations(root);
            }, { message: 'Implementation cleanup failed.' });
            await scope.assert.rejects(async function lateImport() {
                return await olderProbe('./late.mjs');
            }, { message: 'Implementation delivery is closed.' });
        });
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
