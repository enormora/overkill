import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createLineReporter as createOverkillLineReporter } from '../packages/reporter-line/reporter-line.entry-point.ts';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import { defaultRunEngine } from './default-run-engine.ts';
import type { DiscoveredRunFile } from './run-discovery.ts';
import { RunCollectionError } from './run-errors.ts';
import { loadRunTestModules } from './run-test-modules.ts';

const passingFixturePath = 'source/integration-tests/run/fixtures/passing.test.ts';
const duplicateFixturePath = 'source/integration-tests/run/fixtures/duplicate-a.test.ts';
const missingTestNodeFixturePath = 'source/integration-tests/run/fixtures/missing-test-node.test.ts';
const plainTestNodeFixturePath = 'source/integration-tests/run/fixtures/plain-test-node.test.ts';
const throwsOnImportFixturePath = 'source/integration-tests/run/fixtures/throws-on-import.test.ts';

function discoveredFile(file: string): DiscoveredRunFile {
    const path = resolve(process.cwd(), file);

    return {
        file,
        href: pathToFileURL(path).href,
        path
    };
}

export const testSuite = createOverkillSuite({
    title: 'source/run/run-test-modules.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            title: 'loadRunTestModules() imports named testNode exports for the selected engine',
            metadata: {},
            async body(scope: OverkillScope) {
                const testFiles = await loadRunTestModules([
                    discoveredFile(passingFixturePath),
                    discoveredFile(duplicateFixturePath)
                ], defaultRunEngine);

                scope.assert.deepEqual(
                    testFiles.map(function toFile(testFile) {
                        return testFile.file;
                    }),
                    [ passingFixturePath, duplicateFixturePath ]
                );
                scope.assert.equal(
                    testFiles.every(function isOwned(testFile) {
                        return defaultRunEngine.ownsTestNode(testFile.testNode);
                    }),
                    true
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'loadRunTestModules() rejects missing and foreign testNode exports',
            metadata: {},
            async body(scope: OverkillScope) {
                await scope.assert.rejects(async function loadMissingExport() {
                    await loadRunTestModules([ discoveredFile(missingTestNodeFixturePath) ], defaultRunEngine);
                }, { message: `Test module must export testNode: ${missingTestNodeFixturePath}` });
                await scope.assert.rejects(async function loadPlainExport() {
                    await loadRunTestModules([ discoveredFile(plainTestNodeFixturePath) ], defaultRunEngine);
                }, {
                    message: `Test module testNode must be created by the selected engine: ${plainTestNodeFixturePath}`
                });
                await scope.assert.rejects(async function loadForeignEngineExport() {
                    await loadRunTestModules([ discoveredFile(passingFixturePath) ], createTestEngine());
                }, { message: `Test module testNode must be created by the selected engine: ${passingFixturePath}` });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'loadRunTestModules() reports module import failures as collection errors',
            metadata: {},
            async body(scope: OverkillScope) {
                try {
                    await loadRunTestModules([ discoveredFile(throwsOnImportFixturePath) ], defaultRunEngine);
                    scope.assert.fail({ message: 'Expected module import to fail.' });
                } catch (error: unknown) {
                    if (!(error instanceof RunCollectionError)) {
                        throw error;
                    }

                    scope.assert.deepEqual(error.runnerError(), {
                        attributedTo: null,
                        cause: error.cause,
                        message: `Failed to load test module: ${throwsOnImportFixturePath}`,
                        subtype: 'loader'
                    });
                }

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
