import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runIfMain } from '#test-runner';
import { suite, test } from '../test/test.entry-point.ts';
import { createEngine, type TestPlan, type TestScope } from '../engine/engine.entry-point.ts';
import { frozenTypeProject } from '../../test-support/frozen-type-project.ts';
import type { CheckerPreparation } from './checker-plan.ts';
import { prepare } from './compiler-plan.ts';
import { typeTestSettingsSchema, type TypeTestOptions } from './profile-settings.ts';

const sourceFileCount = 300;
type PreparedProject = {
    readonly directory: string;
    readonly original: TestPlan;
    readonly preparation: CheckerPreparation;
    readonly settings: TypeTestOptions;
};

function skippedPlan(): TestPlan {
    const engine = createEngine();
    return engine.createTestPlan(engine.createRoot({
        title: 'frozen facts',
        annotations: {},
        controls: {},
        children: [ engine.createSkippedTestCase({
            title: 'skip',
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            reason: 'deliberate'
        }) ]
    }));
}

async function preparedProject(scope: TestScope): Promise<PreparedProject> {
    const files = Array.from({ length: sourceFileCount }, function (_value, index) {
        return `value${index}.ts`;
    });
    const directory = await frozenTypeProject(scope, {
        ...Object.fromEntries(files.map(function (file) {
            return [ file, 'export type Value = string;' ];
        })),
        'tsconfig.json': JSON.stringify({ compilerOptions: { noLib: true, types: [] }, files })
    });
    const original = skippedPlan();
    const settings: TypeTestOptions = {
        projectConfigPath: join(directory, 'tsconfig.json'),
        compiler: { kind: 'local' }
    };
    return { directory, original, settings, preparation: await prepare(original, settings) };
}

export const testNode = suite('compiler planning', [
    test('rejects empty matrices and non-exact versions', function (scope) {
        scope.assert.false(
            typeTestSettingsSchema
                .safeParse({
                    projectConfigPath: 'tsconfig.json',
                    compiler: { kind: 'matrix', compilers: [] }
                })
                .success
        );
        scope.assert.false(
            typeTestSettingsSchema
                .safeParse({
                    projectConfigPath: 'tsconfig.json',
                    compiler: { kind: 'version', version: '^6.0.3' }
                })
                .success
        );
        return scope.assert.collect();
    }),
    test('preserves complete immutable input facts', async function (scope) {
        const { preparation, original } = await preparedProject(scope);
        const collected = await preparation.collect(preparation.testPlan);
        const json = JSON.stringify(collected.facts);
        scope.assert.includes(json, 'value299.ts');
        scope.assert.includes(json, 'value0.ts');
        scope.assert.false(json.includes('truncated'));
        scope.assert.true(Object.isFrozen(collected.facts));
        scope.assert.true(Object.isFrozen(preparation.testPlan.cases[0].workId));
        scope.assert.deepEqual(preparation.testPlan.cases[0].id, original.cases[0].id);
        return scope.assert.collect();
    }),
    test('rejects foreign preparation', async function (scope) {
        const { preparation, original, settings } = await preparedProject(scope);
        const second = await prepare(original, settings);
        await scope.assert.rejects(async function foreignPlan() {
            await preparation.collect(second.testPlan);
        }, { message: /does not match the frozen project/u });
        return scope.assert.collect();
    }),
    test('rejects duplicate work and foreign discovery', async function (scope) {
        const { preparation } = await preparedProject(scope);
        const plan = preparation.testPlan;
        await scope.assert.rejects(async function () {
            return preparation.collect({ ...plan, cases: [ plan.cases[0], plan.cases[0] ] });
        }, { message: /Duplicate selected/u });
        await scope.assert.rejects(async function () {
            return preparation.collect({ ...plan, discoveredCases: [ plan.discoveredCases[0] ] });
        }, { message: /Discovery does not match/u });
        return scope.assert.collect();
    }),
    test('revalidates inputs before lowering', async function (scope) {
        const { directory, preparation } = await preparedProject(scope);
        const collected = await preparation.collect(preparation.testPlan);
        await writeFile(join(directory, 'value0.ts'), 'export type Value = number;');
        await scope.assert.rejects(async function changedAfterCollection() {
            await collected.lower();
        }, { message: /changed after collection/u });
        return scope.assert.collect();
    })
]);

await runIfMain(import.meta, testNode);
