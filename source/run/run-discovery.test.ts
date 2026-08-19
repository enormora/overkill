import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import { discoverRunFiles } from './run-discovery.ts';

async function withTemporaryDirectory<Result>(run: (directory: string) => Promise<Result>): Promise<Result> {
    const directory = await mkdtemp(join(tmpdir(), 'overkill-discovery-'));

    try {
        return await run(directory);
    } finally {
        await rm(directory, { force: true, recursive: true });
    }
}

async function rejectMissingInputs(scope: OverkillScope, directory: string, filePath: string): Promise<void> {
    await scope.assert.rejects(async function discoverEmptyInput() {
        await discoverRunFiles({ cwd: directory, paths: [] });
    }, { message: 'No explicit run paths were provided.' });
    await scope.assert.rejects(async function discoverMissingCwd() {
        await discoverRunFiles({ cwd: join(directory, 'missing-cwd'), paths: [ filePath ] });
    }, { message: `Run cwd does not exist: ${join(directory, 'missing-cwd')}` });
    await scope.assert.rejects(async function discoverEmptyPath() {
        await discoverRunFiles({ cwd: directory, paths: [ ' ' ] });
    }, { message: 'Run path must not be empty.' });
    await scope.assert.rejects(async function discoverMissingPath() {
        await discoverRunFiles({ cwd: directory, paths: [ 'missing.test.ts' ] });
    }, { message: 'Run path does not exist: missing.test.ts' });
}

async function rejectInvalidFileShapes(
    scope: OverkillScope,
    directory: string,
    filePath: string,
    outsideFilePath: string
): Promise<void> {
    await scope.assert.rejects(async function discoverDirectoryPath() {
        await discoverRunFiles({ cwd: directory, paths: [ '.' ] });
    }, { message: 'Run path must be a file: .' });
    await scope.assert.rejects(async function discoverOutsidePath() {
        await discoverRunFiles({ cwd: directory, paths: [ outsideFilePath ] });
    }, { message: `Run path must stay inside cwd: ${outsideFilePath}` });
    await scope.assert.rejects(async function discoverDuplicatePath() {
        await discoverRunFiles({ cwd: directory, paths: [ 'example.test.ts', filePath ] });
    }, { message: 'Run path must not be duplicated: example.test.ts' });
}

export const testSuite = createOverkillSuite({
    name: 'source/run/run-discovery.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'discoverRunFiles() resolves canonical file identities under cwd',
            metadata: {},
            async body(scope: OverkillScope) {
                await withTemporaryDirectory(async function testTemporaryDirectory(directory) {
                    const nestedDirectory = join(directory, 'nested');
                    const filePath = join(nestedDirectory, 'example.test.ts');

                    await mkdir(nestedDirectory);
                    await writeFile(filePath, 'export const testNode = null;\n');

                    const files = await discoverRunFiles({
                        cwd: directory,
                        paths: [ 'nested/example.test.ts' ]
                    });

                    scope.assert.deepEqual(files, [
                        {
                            file: 'nested/example.test.ts',
                            href: pathToFileURL(filePath).href,
                            path: filePath
                        }
                    ]);
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'discoverRunFiles() rejects invalid explicit inputs before import',
            metadata: {},
            async body(scope: OverkillScope) {
                await withTemporaryDirectory(async function testTemporaryDirectory(directory) {
                    const outsideDirectory = await mkdtemp(join(tmpdir(), 'overkill-outside-'));

                    try {
                        const filePath = join(directory, 'example.test.ts');
                        const outsideFilePath = join(outsideDirectory, 'outside.test.ts');

                        await writeFile(filePath, 'export const testNode = null;\n');
                        await writeFile(outsideFilePath, 'export const testNode = null;\n');

                        await rejectMissingInputs(scope, directory, filePath);
                        await rejectInvalidFileShapes(scope, directory, filePath, outsideFilePath);
                    } finally {
                        await rm(outsideDirectory, { force: true, recursive: true });
                    }
                });

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
