import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { suite as authoredSuite, test } from '@overkill-dev/test';

import { z } from 'zod/v4';
import { createTemporaryDirectoryResource, startResources } from '../packages/resources/resources.entry-point.ts';

import {
    defineBodyReference,
    defineTestFamily,
    type Engine,
    type TestPlan,
    type TestBody
} from '../packages/engine/engine.entry-point.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import { withImplementationPlan } from './body-reference-plan.ts';

const nodeMetadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
const family = defineTestFamily({
    id: '@example/portable',
    version: '1',
    module: null,
    features: { execution: 'runtime', processModels: [ 'in-process' ], profileOptions: [] },
    parseSettings() {
        return null;
    },
    async load() {
        return {
            async prepare(input) {
                return {
                    testPlan: input.testPlan,
                    facts: null,
                    async collect() {
                        return { kind: 'runtime', facts: null };
                    },
                    async dispose() {
                        return undefined;
                    }
                };
            }
        };
    }
});

function plan(engine: Engine, directory: string): TestPlan {
    return engine.createTestPlan(engine.createRoot({
        ...nodeMetadata,
        title: 'root',
        children: [
            engine.createTestCase({
                ...nodeMetadata,
                title: 'portable body',
                body: defineBodyReference({
                    module: { moduleUrl: pathToFileURL(join(directory, 'body.mjs')).href, exportName: 'body' },
                    realm: 'host',
                    version: '1',
                    input: { expected: 42 },
                    dynamicModules: [],
                    parseInput(input: unknown) {
                        return z.object({ expected: z.number() }).parse(input);
                    }
                })
            })
        ]
    }));
}

async function fixture<Value>(
    signal: Readonly<AbortSignal>,
    use: (directory: string) => Promise<Value>
): Promise<Value> {
    await using session = await startResources({
        resources: { directory: createTemporaryDirectoryResource('directory') },
        signal
    });
    const directory = session.context.directory.path;
    await writeFile(
        join(directory, 'body.mjs'),
        [
            "export const body = { version: '1', implementation(scope, input) {",
            'scope.assert.equal(input.expected, 42); return scope.assert.collect();',
            '} };'
        ]
            .join('\n')
    );
    return await use(directory);
}

function replacedBody(source: TestPlan, body: TestBody): TestPlan {
    const [ first, ...rest ] = source.cases;
    return { ...source, cases: [ { ...first, execution: { kind: 'body', bodyMode: 'builder', body } }, ...rest ] };
}
export const testNode = authoredSuite('referenced body execution', [
    test('rejects references introduced into a historical plan without provenance', async function (scope) {
        await fixture(scope.signal, async function execute(directory) {
            const engine = createTestEngine();
            const frozen = withImplementationPlan(plan(engine, directory), { catalog: null, admission: 'all' });
            await scope.assert.rejects(async function withoutProvenance() {
                await engine.execute(frozen);
            }, { message: 'Frozen execution has no implementation provenance; prepare a new run.' });
        });
        return scope.assert.collect();
    }),
    test('rejects removing a recorded reference before executing its replacement', async function (scope) {
        await fixture(scope.signal, async function verify(directory) {
            const engine = createTestEngine();
            const source = plan(engine, directory);
            const controller = new AbortController();
            await using prepared = await engine.prepareFamily({
                testPlan: source,
                testFamily: family,
                projectRoot: directory,
                settings: null,
                signal: controller.signal
            });
            const collected = await prepared.collect({
                workIds: source.cases.map(function key(testCase) {
                    return testCase.workId;
                }),
                signal: controller.signal
            });
            let executed = false;
            const changed = replacedBody(collected.testPlan, function replacement(replacementScope) {
                executed = true;
                return replacementScope.assert.collect();
            });
            await scope.assert.rejects(async function changedImplementation() {
                return await engine.execute(changed);
            }, { message: 'Frozen implementation assignments changed; prepare and collect a new run.' });
            scope.assert.equal(executed, false);
        });
        return scope.assert.collect();
    }),
    test('executes an explicitly prepared reference through the public engine', async function (scope) {
        await fixture(scope.signal, async function execute(directory) {
            const engine = createTestEngine();
            const testPlan = plan(engine, directory);
            const { signal } = new AbortController();
            await using prepared = await engine.prepareFamily({
                testPlan,
                testFamily: family,
                projectRoot: directory,
                settings: null,
                signal
            });
            const collected = await prepared.collect({
                workIds: testPlan.cases.map(function id(entry) {
                    return entry.workId;
                }),
                signal
            });
            scope.assert.equal(collected.facts.collection, null);
            const result = await engine.execute(collected, {
                debug: { mode: 'off' },
                signal,
                execution: { mode: 'serial-in-process' },
                retryPolicy: null,
                reporters: [],
                runFacts: {},
                startedAt: '2026-11-15T00:00:00.000Z'
            });
            scope.assert.equal(result.perTest[0]?.verdict, 'pass');
            scope.assert.equal(result.runnerErrors.length, 0);
        });
        return scope.assert.collect();
    }),
    test('rejects references executed without an explicit preparation root', async function (scope) {
        await fixture(scope.signal, async function execute(directory) {
            const engine = createTestEngine();
            await scope.assert.rejects(async function withoutPreparation() {
                await engine.execute(plan(engine, directory));
            }, { message: 'Referenced implementations require explicit family preparation and collection.' });
        });
        return scope.assert.collect();
    })
]);
