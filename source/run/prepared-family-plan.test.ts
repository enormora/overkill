import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { defineTestFamily } from '../packages/engine/engine.entry-point.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import { normalizeConfig } from '../packages/run/run.entry-point.ts';
import { bindFamilySettings } from '../engine/test-family.ts';
import { snapshotProfileFamily } from './family-profile-transport.ts';
import type { RunnerFamilyPreparation } from './family-profile-types.ts';
import { collectedRunPlanSchema } from './collected-run-plan-schema.ts';
import { preparedFamilyMetadata, selectedPreparedPlan } from './prepared-family-plan.ts';

const family = defineTestFamily({
    id: '@example/recorded-local',
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
                    testPlan: input.expandVariants([ { key: 'first', facts: null }, { key: 'second', facts: null } ]),
                    facts: { prepared: true },
                    async collect({ workIds }) {
                        return { kind: 'runtime', facts: { selected: workIds.length } };
                    },
                    async dispose() {
                        return undefined;
                    }
                };
            }
        };
    }
});
const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;

function rejectBodyExecution(): never {
    throw new Error('Plan inspection must not execute bodies.');
}

const localProfile = {
    testFamily: family,
    settings: null,
    files: { include: [ 'case.ts' ] },
    execution: { processModel: 'in-process', scheduling: 'serial' }
} as const;

async function preparation(): Promise<RunnerFamilyPreparation> {
    const engine = createTestEngine();
    const { signal } = new AbortController();
    const sourcePlan = engine.createTestPlanFromTestFiles({
        files: [ {
            file: 'case.ts',
            testNode: engine.createTestCase({ ...metadata, title: 'case', body: rejectBodyExecution })
        } ],
        root: { annotations: {}, controls: {}, title: 'root' }
    });
    const profile = normalizeConfig({ profiles: { local: localProfile } }).profiles.local;
    if (profile === undefined) {
        throw new Error('Missing local profile.');
    }
    const definition = snapshotProfileFamily({
        profile,
        profileName: 'local',
        projectRoot: '/project',
        definitionLocationCapture: 'disabled',
        source: {
            kind: 'configured-source',
            source: {
                kind: 'config-file',
                resolvedPath: '/project/config.ts',
                request: { cwd: '/project', configPath: '/project/config.ts' }
            }
        }
    });
    const binding = bindFamilySettings(family, null);
    const prepared = await engine.prepareFamily({
        testPlan: sourcePlan,
        testFamily: family,
        settings: null,
        projectRoot: '/project',
        signal
    });
    return { engine, signal, sourcePlan, definition, binding, prepared, projectRoot: '/project' };
}

export const testNode = suite('prepared family record plans', [
    test(
        'retains configuration-only provenance and the full catalog alongside selected facts',
        async function (scope: TestScope) {
            const context = await preparation();
            await using prepared = context.prepared;
            const selected = await prepared.collect({
                workIds: [ prepared.testPlan.cases[0].workId ],
                signal: context.signal
            });
            const record = preparedFamilyMetadata(context, selected.facts);
            scope.require.defined(record);
            scope.assert.deepEqual(structuredClone<unknown>(record.definition.source), {
                kind: 'config-file',
                configPath: '/project/config.ts',
                profile: 'local'
            });
            scope.assert.deepEqual(structuredClone<unknown>(record.facts.collection), { selected: 1 });
            const catalog = collectedRunPlanSchema.parse(record.definition.checkpoint?.catalog);
            scope.assert.deepEqual(
                catalog.files.flatMap(function variants(file) {
                    return file.cases.map(function key(testCase) {
                        return testCase.workId?.familyVariant?.key;
                    });
                }),
                [ 'first', 'second' ]
            );
            return scope.assert.collect();
        }
    ),
    test('does not invent transport provenance for local-only preparations', async function (scope) {
        const context = await preparation();
        await using prepared = context.prepared;
        scope.assert.equal(
            preparedFamilyMetadata({ ...context, definition: null }, { ...prepared.facts, collection: null }),
            null
        );
        return scope.assert.collect();
    }),
    test('selects the current prepared work by complete family identity', async function (scope: TestScope) {
        const context = await preparation();
        await using prepared = context.prepared;
        const second = prepared.testPlan.cases[1];
        scope.require.defined(second);
        const selected = selectedPreparedPlan(prepared, { ...prepared.testPlan, cases: [ second ] });
        scope.assert.equal(selected.cases.length, 1);
        scope.assert.equal(selected.cases[0], second);
        return scope.assert.collect();
    }),
    test('rejects selected identities absent from the fresh preparation', async function (scope) {
        const context = await preparation();
        await using prepared = context.prepared;
        const original = prepared.testPlan.cases[0];
        const stale = {
            ...original,
            workId: { ...original.workId, familyVariant: { family: family.id, key: 'removed' } }
        };
        scope.assert.throws(function selectStaleFamilyWork() {
            selectedPreparedPlan(prepared, { ...prepared.testPlan, cases: [ stale ] });
        }, { message: 'Prepared family work changed between invocations.' });
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
