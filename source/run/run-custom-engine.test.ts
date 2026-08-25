import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import {
    defaultMicrotestProfile,
    defaultRunConfig,
    defaultRunRequest
} from '../test-support/run-command-factory.ts';
import { defaultRunEngine } from './default-run-engine.ts';
import { loadRunEngineModule } from './run-engine-selection.ts';
import { orchestrator } from './run-orchestrator.entry-point.ts';
import type { RunCommand, RunConfig, RunRequest } from './run-types.ts';

type RunCommandParts = {
    readonly config: RunConfig;
    readonly cwd: string;
    readonly engine: RunCommand['engine'];
    readonly request: RunRequest;
};

const customEngineFixturePath = 'source/integration-tests/run/fixtures/custom-engine.ts';
const customEnginePassingFixturePath = 'source/integration-tests/run/fixtures/custom-engine-passing.test.ts';
const passingFixturePath = 'source/integration-tests/run/fixtures/passing.test.ts';
const customEngineModuleUrl = pathToFileURL(`${process.cwd()}/${customEngineFixturePath}`).href;
const supervisedCollectionConfig: RunConfig = defaultRunConfig({
    profiles: {
        microtest: defaultMicrotestProfile({
            timeouts: { collectionMilliseconds: 5000 }
        })
    }
});

function createRunCommand(overrides: RunCommandParts): RunCommand {
    return {
        config: overrides.config,
        cwd: overrides.cwd,
        engine: overrides.engine,
        request: overrides.request
    };
}

async function writeCustomEngineModule(source: string): Promise<string> {
    const directory = `${process.cwd()}/target/custom-engine-modules`;
    const modulePath = `${directory}/custom-engine-${randomUUID()}.js`;

    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(modulePath, source, 'utf8');

    return pathToFileURL(modulePath).href;
}

function customEngineCommand(
    exportName: string,
    exportKind: 'getter' | 'value',
    paths = [ customEnginePassingFixturePath ]
): RunCommand {
    return createRunCommand({
        config: supervisedCollectionConfig,
        cwd: process.cwd(),
        engine: {
            exportKind,
            exportName,
            kind: 'module',
            moduleUrl: customEngineModuleUrl
        },
        request: defaultRunRequest({ paths })
    });
}

function moduleEngine(moduleUrl: string, exportName: string, exportKind: 'getter' | 'value'): Extract<
    RunCommand['engine'],
    { readonly kind: 'module'; }
> {
    return {
        exportKind,
        exportName,
        kind: 'module',
        moduleUrl
    };
}

function invalidCustomEngineCommand(engine: RunCommand['engine']): RunCommand {
    return createRunCommand({
        config: supervisedCollectionConfig,
        cwd: process.cwd(),
        engine,
        request: defaultRunRequest({ paths: [ customEnginePassingFixturePath ] })
    });
}

export const testSuite = createOverkillSuite({
    name: 'source/run/run-custom-engine.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'orchestrator.run() rejects instance engines for supervised execution',
            metadata: {},
            async body(scope: OverkillScope) {
                await scope.assert.rejects(async function runWithCustomSupervisedEngine() {
                    await orchestrator.run(createRunCommand({
                        config: defaultRunConfig(),
                        cwd: process.cwd(),
                        engine: { engine: defaultRunEngine, kind: 'instance' },
                        request: defaultRunRequest({ paths: [ passingFixturePath ] })
                    }));
                }, {
                    message:
                        'Instance engines are not supported with supervised-process execution. Use a module engine.'
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'orchestrator.run() rejects invalid supervised module engine requests',
            metadata: {},
            async body(scope: OverkillScope) {
                await scope.assert.rejects(async function runWithEmptyModuleUrl() {
                    await orchestrator.run(invalidCustomEngineCommand({
                        exportKind: 'value',
                        exportName: 'engine',
                        kind: 'module',
                        moduleUrl: ''
                    }));
                }, { message: 'Custom engine moduleUrl must not be empty.' });
                await scope.assert.rejects(async function runWithEmptyExportName() {
                    await orchestrator.run(invalidCustomEngineCommand({
                        exportKind: 'value',
                        exportName: '',
                        kind: 'module',
                        moduleUrl: customEngineModuleUrl
                    }));
                }, { message: 'Custom engine exportName must not be empty.' });
                await scope.assert.rejects(async function runWithRemoteModuleUrl() {
                    await orchestrator.run(invalidCustomEngineCommand({
                        exportKind: 'value',
                        exportName: 'engine',
                        kind: 'module',
                        moduleUrl: 'https://example.invalid/custom-engine.js'
                    }));
                }, { message: 'Supervised custom engine moduleUrl must be a file URL under cwd.' });
                await scope.assert.rejects(async function runWithOutsideModuleUrl() {
                    await orchestrator.run(invalidCustomEngineCommand({
                        exportKind: 'value',
                        exportName: 'engine',
                        kind: 'module',
                        moduleUrl: pathToFileURL(`${process.cwd()}-outside/custom-engine.js`).href
                    }));
                }, { message: 'Supervised custom engine moduleUrl must be under cwd.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'loadRunEngineModule() loads value and getter engine exports',
            metadata: {},
            async body(scope: OverkillScope) {
                const moduleUrl = await writeCustomEngineModule(`
                    const method = () => undefined;
                    export const engine = {
                        createRoot: method,
                        createSuite: method,
                        createTable: method,
                        createTestCase: method,
                        createTestPlan: method,
                        createTestPlanFromTestFiles: method,
                        execute: method,
                        formatCaseId: method,
                        ownsTestNode: method,
                        runIfMain: method
                    };
                    export function getEngine() {
                        return engine;
                    }
                `);

                const valueEngine = await loadRunEngineModule(moduleEngine(moduleUrl, 'engine', 'value'));
                const getterEngine = await loadRunEngineModule(moduleEngine(moduleUrl, 'getEngine', 'getter'));

                scope.assert.equal(typeof valueEngine.execute, 'function');
                scope.assert.equal(typeof getterEngine.runIfMain, 'function');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'loadRunEngineModule() reports invalid module exports',
            metadata: {},
            async body(scope: OverkillScope) {
                const moduleUrl = await writeCustomEngineModule(`
                    export const invalidEngine = {};
                    export const getEngine = {};
                `);

                await scope.assert.rejects(async function loadMissingEngineExport() {
                    await loadRunEngineModule(moduleEngine(moduleUrl, 'engine', 'value'));
                }, { message: 'Custom engine module must export engine.' });
                await scope.assert.rejects(async function loadInvalidEngineExport() {
                    await loadRunEngineModule(moduleEngine(moduleUrl, 'invalidEngine', 'value'));
                }, { message: 'Custom engine module export must be an Engine.' });
                await scope.assert.rejects(async function loadInvalidEngineGetter() {
                    await loadRunEngineModule(moduleEngine(moduleUrl, 'getEngine', 'getter'));
                }, { message: 'Custom engine getter export must be a function.' });
                await scope.assert.rejects(async function loadMissingEngineModule() {
                    await loadRunEngineModule(
                        moduleEngine(pathToFileURL(`${process.cwd()}-missing.js`).href, 'engine', 'value')
                    );
                }, { message: 'Failed to load custom engine module.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'orchestrator.run() executes a supervised module engine value export',
            metadata: {},
            async body(scope: OverkillScope) {
                const result = await orchestrator.run(customEngineCommand('engine', 'value'));

                scope.assert.equal(result.summary.passed, 1);
                scope.assert.equal(result.runnerErrors.length, 0);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'orchestrator.resolve() collects a supervised module engine getter export',
            metadata: {},
            async body(scope: OverkillScope) {
                const resolvedRun = await orchestrator.resolve(customEngineCommand('getEngine', 'getter'));
                const firstCase = resolvedRun.facts.cases[0];

                scope.require.defined(firstCase);
                scope.assert.equal(resolvedRun.plan.kind, 'supervised');
                scope.assert.deepEqual(firstCase.id, {
                    file: customEnginePassingFixturePath,
                    name: 'custom engine passes',
                    params: null,
                    suite: []
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'orchestrator.run() reports invalid module engine exports',
            metadata: {},
            async body(scope: OverkillScope) {
                const invalidValueResult = await orchestrator.run(customEngineCommand('invalidEngine', 'value'));
                const asyncGetterResult = await orchestrator.run(customEngineCommand('getAsyncEngine', 'getter'));

                scope.assert.equal(
                    invalidValueResult.runnerErrors[0]?.message,
                    'Custom engine module export must be an Engine.'
                );
                scope.assert.equal(
                    asyncGetterResult.runnerErrors[0]?.message,
                    'Custom engine module export must be an Engine.'
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'orchestrator.run() rejects module engines when test nodes use another engine',
            metadata: {},
            async body(scope: OverkillScope) {
                const result = await orchestrator.run(customEngineCommand('engine', 'value', [ passingFixturePath ]));

                scope.assert.equal(
                    result.runnerErrors[0]?.message,
                    `Test module testNode must be created by the selected engine: ${passingFixturePath}`
                );

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
