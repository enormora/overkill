import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestNode,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import { defaultRunEngine } from './default-run-engine.ts';
import type { DiscoveredRunFile } from './run-discovery-types.ts';
import { RunCollectionError } from './run-errors.ts';
import { createRunTestModuleLoader, type RunTestModuleLoader } from './run-test-modules.ts';

const passingFixturePath = 'source/integration-tests/run/fixtures/passing.test.ts';
const duplicateFixturePath = 'source/integration-tests/run/fixtures/duplicate-a.test.ts';
const missingTestNodeFixturePath = 'source/integration-tests/run/fixtures/missing-test-node.test.ts';
const plainTestNodeFixturePath = 'source/integration-tests/run/fixtures/plain-test-node.test.ts';
const throwsOnImportFixturePath = 'source/integration-tests/run/fixtures/throws-on-import.test.ts';

function discoveredFile(file: string): DiscoveredRunFile {
    return {
        fileSet: null,
        file,
        href: `virtual:${file}`,
        path: `/project/${file}`
    };
}

function createPassingTestNode(title: string): TestNode {
    return defaultRunEngine.createTestCase({
        definitionLocations: [ { kind: 'unknown' as const } ],
        annotations: {},
        controls: {},
        title,
        body(scope) {
            scope.assert.true(true);

            return scope.assert.collect();
        }
    });
}

function createVirtualRunTestModuleLoader(modules: Readonly<Record<string, unknown>>): RunTestModuleLoader {
    return createRunTestModuleLoader({
        async importModule(href) {
            if (href === `virtual:${throwsOnImportFixturePath}`) {
                throw new Error('fixture import failed');
            }

            if (!Object.hasOwn(modules, href)) {
                throw new Error(`Missing virtual test module: ${href}`);
            }

            return modules[href];
        }
    });
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/run-test-modules.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'loadRunTestModules() imports named testNode exports for the selected engine',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const loadRunTestModules = createVirtualRunTestModuleLoader({
                    [`virtual:${passingFixturePath}`]: { testNode: createPassingTestNode('passes') },
                    [`virtual:${duplicateFixturePath}`]: { testNode: createPassingTestNode('duplicate') }
                });
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
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'loadRunTestModules() rejects missing and foreign testNode exports',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const loadRunTestModules = createVirtualRunTestModuleLoader({
                    [`virtual:${missingTestNodeFixturePath}`]: {},
                    [`virtual:${plainTestNodeFixturePath}`]: { testNode: {} },
                    [`virtual:${passingFixturePath}`]: { testNode: createPassingTestNode('passes') }
                });

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
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'loadRunTestModules() reports module import failures as collection errors',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const loadRunTestModules = createVirtualRunTestModuleLoader({});

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

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
