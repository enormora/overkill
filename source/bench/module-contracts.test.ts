import { setTimeout as startTimer, clearTimeout as clearTimer } from 'node:timers';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { createModuleSample, type ModuleSampleLifetime } from './module-sampling.ts';
import { createProcessSamplingSession } from './process-sampling.ts';
import { processMeasurement } from './process-measurement.ts';

async function moduleSample(scope: TestScope, signal: AbortSignal): Promise<ModuleSampleLifetime> {
    const session = createProcessSamplingSession(processMeasurement({ instrumentation: 'off' }), signal);
    scope.cleanup(session.dispose);
    const sample = createModuleSample(session, 'measured');
    scope.cleanup(sample.dispose);
    return sample;
}
async function moduleFile(scope: TestScope, name: string, source: string): Promise<URL> {
    const directory = await mkdtemp(join(tmpdir(), 'overkill-import-contract-'));
    scope.cleanup(async function removeModule() {
        await rm(directory, { recursive: true, force: true });
    });
    const filename = join(directory, name);
    await writeFile(filename, source);
    return pathToFileURL(filename);
}

export const testNode = suite('module import failure contracts', [
    test('rejects non-file URLs before launching an import', async function (scope) {
        const lifetime = await moduleSample(scope, scope.signal);
        await scope.assert.rejects(async function unsupportedUrl() {
            return await lifetime.sample.importModule({
                url: new URL('https://example.invalid/module'),
                cwd: process.cwd(),
                env: null,
                nodeArguments: []
            });
        }, { message: 'Module import requires an absolute file URL.' });
        scope.assert.throws(lifetime.ensureMeasured, {
            message: 'Each sample must await exactly one successful module import.'
        });
        return scope.assert.collect();
    }),
    test('rejects a child that exits before reporting its import', async function (scope) {
        const url = await moduleFile(scope, 'entry.cjs', 'process.exit(0);');
        const lifetime = await moduleSample(scope, scope.signal);
        await scope.assert.rejects(async function missingReport() {
            return await lifetime.sample.importModule({ url, cwd: process.cwd(), env: null, nodeArguments: [] });
        }, { message: 'Module exited without an import report.' });
        scope.assert.throws(lifetime.ensureMeasured, {
            message: 'Each sample must await exactly one successful module import.'
        });
        return scope.assert.collect();
    }),
    test('imports CommonJS without invoking exported functions and rejects a second import', async function (scope) {
        const url = await moduleFile(
            scope,
            'entry.cjs',
            'module.exports = () => { throw new Error("export called"); };'
        );
        const lifetime = await moduleSample(scope, scope.signal);
        const request = { url, cwd: process.cwd(), env: null, nodeArguments: [ '--no-warnings' ] };
        const result = await lifetime.sample.importModule(request);
        scope.assert.equal(result.value.url, url.href);
        scope.assert.true(result.value.nodeArguments.includes('--no-warnings'));
        lifetime.ensureMeasured();
        await scope.assert.rejects(async function duplicate() {
            return await lifetime.sample.importModule(request);
        }, {
            message: 'Each sample must import exactly one module.'
        });
        scope.assert.throws(lifetime.ensureMeasured, {
            message: 'Each sample must await exactly one successful module import.'
        });
        return scope.assert.collect();
    }),
    test('rejects module evaluation failures even when the caller catches them', async function (scope) {
        const url = await moduleFile(scope, 'entry.mjs', 'throw new Error("cold import failed");');
        const lifetime = await moduleSample(scope, scope.signal);
        await scope.assert.rejects(
            async function failedImport() {
                return await lifetime.sample.importModule({ url, cwd: process.cwd(), env: null, nodeArguments: [] });
            },
            { message: 'cold import failed' }
        );
        scope.assert.throws(lifetime.ensureMeasured, {
            message: 'Each sample must await exactly one successful module import.'
        });
        return scope.assert.collect();
    }),
    test('cancels unfinished top-level evaluation through process ownership', async function (scope) {
        const url = await moduleFile(scope, 'entry.mjs', 'await new Promise(() => { setInterval(() => {}, 100); });');
        const controller = new AbortController();
        const lifetime = await moduleSample(scope, controller.signal);
        const pending = lifetime.sample.importModule({ url, cwd: process.cwd(), env: null, nodeArguments: [] });
        const timer = startTimer(function cancelImport() {
            controller.abort(new Error('import cancelled'));
        }, 1000);
        scope.cleanup(function clearCancellation() {
            clearTimer(timer);
        });
        await scope.assert.rejects(async function cancelledImport() {
            return await pending;
        }, { message: 'import cancelled' });
        scope.assert.throws(lifetime.ensureMeasured, {
            message: 'Each sample must await exactly one successful module import.'
        });
        return scope.assert.collect();
    })
]);
