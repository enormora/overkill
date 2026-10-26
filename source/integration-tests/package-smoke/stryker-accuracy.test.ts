import { runIfMain } from '#test-runner';
import { createSuite, createTestCase } from '@overkill-dev/engine';
import { mutationModes, mutationModulesSchema } from '../run/fixtures/mutation-evidence/mutation-project.test.ts';
import { verifyMutationAccuracy } from '../run/mutation-accuracy-driver.test.ts';

const packages = {
    adapter: '@overkill-dev/stryker-runner',
    core: '@stryker-mutator/core',
    engine: '@overkill-dev/engine',
    config: '@overkill-dev/run/config',
    runner: '@overkill-dev/run',
    instrumenter: '@stryker-mutator/instrumenter',
    plugin: '@stryker-mutator/api/plugin',
    testRunner: '@stryker-mutator/api/test-runner',
    clock: '@enormora/clock'
};
const modules = mutationModulesSchema.parse(Object.fromEntries(
    Object.entries(packages).map(function resolvePackage([ name, specifier ]) {
        return [ name, import.meta.resolve(specifier) ];
    })
));
const comparisons = mutationModes.flatMap(function executionModes(mode) {
    return ([ 'all', 'off' ] as const).map(function fullSuiteModes(coverage) {
        return { mode, coverage };
    });
});

export const testNode = createSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'packaged mutation campaign accuracy',
    children: comparisons.map(function comparison({ mode, coverage }) {
        return createTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            title: `${mode.processModel} freshState ${String(mode.freshState)} perTest versus ${coverage}`,
            async body(scope) {
                const evidence = await verifyMutationAccuracy(modules, mode, '42', [ 'perTest', coverage ]);
                scope.assert.equal(
                    evidence
                        .flatMap(function (campaign) {
                            return campaign.mutants;
                        })
                        .filter(function (mutant) {
                            return mutant.status === 'Killed';
                        })
                        .length,
                    12
                );
                return scope.assert.collect();
            }
        });
    })
});

await runIfMain(import.meta, testNode);
