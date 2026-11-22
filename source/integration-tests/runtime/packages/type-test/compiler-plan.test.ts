import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { suite, test, type TestScope } from '@overkill-dev/test';

import { createEngine, type TestPlan } from '../../../../packages/engine/engine.entry-point.ts';

import { frozenTypeProject } from '../../../../test-support/frozen-type-project.ts';
import { observationPlan } from '../../../../test-support/observation-lifetime.ts';
import type { CheckerPreparation } from '../../../../packages/type-test/checker-plan.ts';
import { prepare } from '../../../../packages/type-test/compiler-plan.ts';
import { typeTestSettingsSchema, type TypeTestSettings } from '../../../../packages/type-test/profile-settings.ts';

const sourceFileCount = 300;
type PreparedProject = {
    readonly directory: string;
    readonly original: TestPlan;
    readonly preparation: CheckerPreparation;
    readonly settings: TypeTestSettings;
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

async function preparedProject(cleanup: TestScope['cleanup'], signal: AbortSignal, original: TestPlan): Promise<PreparedProject> {
    const files = Array.from({ length: sourceFileCount }, function (_value, index) {
        return `value${index}.ts`;
    });
    const directory = await frozenTypeProject(cleanup, {
        ...Object.fromEntries(files.map(function (file) {
            return [ file, 'export type Value = string;' ];
        })),
        'tsconfig.json': JSON.stringify({ compilerOptions: { noLib: true, types: [] }, files })
    });
    const settings: TypeTestSettings = {
        projectConfigPath: join(directory, 'tsconfig.json'),
        compiler: { kind: 'package', specifier: 'typescript-beta', version: '7.1.0-beta' }
    };
    const preparation = await prepare(original, settings, {
        projectRoot: process.cwd(),
        signal,
        expandVariants: null
    });
    cleanup(async function () {
        await preparation.dispose();
    });
    return { directory, original, settings, preparation };
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
        const { preparation, original } = await preparedProject(scope.cleanup, scope.signal, skippedPlan());
        const collected = await preparation.collect(preparation.testPlan, scope.signal);
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
        const { preparation, original, settings } = await preparedProject(scope.cleanup, scope.signal, skippedPlan());
        const second = await prepare(original, settings, {
            projectRoot: process.cwd(),
            signal: scope.signal,
            expandVariants: null
        });
        scope.cleanup(async function () {
            await second.dispose();
        });
        await scope.assert.rejects(async function foreignPlan() {
            await preparation.collect(second.testPlan, scope.signal);
        }, { message: /does not match the frozen project/u });
        return scope.assert.collect();
    }),
    test('rejects duplicate work and foreign discovery', async function (scope) {
        const { preparation } = await preparedProject(scope.cleanup, scope.signal, skippedPlan());
        const plan = preparation.testPlan;
        await scope.assert.rejects(async function () {
            return preparation.collect(
                { ...plan, cases: [ plan.cases[0], plan.cases[0] ] },
                scope.signal
            );
        }, { message: /Duplicate selected/u });
        await scope.assert.rejects(async function () {
            return preparation.collect(
                { ...plan, discoveredCases: [ plan.discoveredCases[0] ] },
                scope.signal
            );
        }, { message: /Discovery does not match/u });
        return scope.assert.collect();
    }),
    test('revalidates inputs before checking', async function (scope) {
        const { directory, preparation } = await preparedProject(scope.cleanup, scope.signal, observationPlan());
        const collected = await preparation.collect(preparation.testPlan, scope.signal);
        await writeFile(join(directory, 'value0.ts'), 'export type Value = number;');
        const { result, facts } = await collected.execute(scope.signal);
        scope.assert.includes(result.runnerErrors[0]?.message ?? '', 'changed after collection');
        scope.assert.equal(result.perTest[0]?.verdict, 'inconclusive');
        scope.assert.deepEqual<unknown, unknown>(facts, collected.facts);
        return scope.assert.collect();
    })
]);
