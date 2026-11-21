import { suite, test } from '@overkill-dev/test';

import type { TestNode as SubjectTestNode } from '../packages/engine/engine.entry-point.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import { defaultRunEngine } from './default-run-engine.ts';
import type { DiscoveredRunFile } from './run-types.ts';
import { RunCollectionError } from './run-errors.ts';
import { createRunTestModuleLoader, type RunTestModuleLoader } from './run-test-modules.ts';

const passingFixturePath = 'source/integration-tests/runtime/fixtures/passing.test.ts';
const duplicateFixturePath = 'source/integration-tests/runtime/fixtures/duplicate-a.test.ts';
const missingTestNodeFixturePath = 'source/integration-tests/runtime/fixtures/missing-test-node.test.ts';
const plainTestNodeFixturePath = 'source/integration-tests/runtime/fixtures/plain-test-node.test.ts';
const throwsOnImportFixturePath = 'source/integration-tests/runtime/fixtures/throws-on-import.test.ts';

function discoveredFile(file: string): DiscoveredRunFile {
    return {
        fileSet: null,
        file,
        href: `virtual:${file}`,
        path: `/project/${file}`
    };
}

function createPassingTestNode(title: string): SubjectTestNode {
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

export const testNode = suite('Test module loading', [
    test(
        'imports named testNode exports for the selected engine',
        async function (scope) {
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
    ),
    test('rejects missing and foreign testNode exports', async function (scope) {
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
    }),
    test(
        'reports module import failures as collection errors',
        async function (scope) {
            const loadRunTestModules = createVirtualRunTestModuleLoader({});

            try {
                await loadRunTestModules([ discoveredFile(throwsOnImportFixturePath) ], defaultRunEngine);
                scope.assert.fail({ message: 'Expected module import to fail.' });
            } catch (error: unknown) {
                if (!(error instanceof RunCollectionError)) {
                    throw error;
                }

                scope.assert.deepEqual(error.runnerError(), {
                    attributedToAttempt: null,
                    attributedTo: null,
                    attributedToWork: null,
                    cause: error.cause,
                    diagnostics: [],
                    message: `Failed to load test module: ${throwsOnImportFixturePath}`,
                    subtype: 'loader'
                });
            }

            return scope.assert.collect();
        }
    )
]);
