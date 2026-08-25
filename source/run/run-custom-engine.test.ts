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

export const testSuite = createOverkillSuite({
    name: 'source/run/run-custom-engine.test.ts',
    metadata: {},
    children: [
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
