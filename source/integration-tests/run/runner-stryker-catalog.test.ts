import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runIfMain } from '#test-runner';
import { suite, test } from '../../packages/test/test.entry-point.ts';
import { createLineReporter } from '../../packages/reporter-line/reporter-line.entry-point.ts';
import { adapterUrl, engineUrl, configUrl, executeMutationScript } from './stryker-lifecycle-fixture.test.ts';
import { strykerCatalogScript } from './stryker-catalog-scripts.test.ts';

const modes = ([ 'in-process', 'supervised-process' ] as const).flatMap(function processModes(processModel) {
    return [ false, true ].flatMap(function stateModes(freshState) {
        return [ 'all-files', 'listed-files', 'skips' ].map(function restrictions(restriction) {
            return { processModel, freshState, restriction };
        });
    });
});

export const testNode = suite(
    'Stryker catalog execution',
    modes.map(function scenario({ processModel, freshState, restriction }) {
        return test(
            `${processModel} freshState ${String(freshState)} ${restriction} freezes the catalog`,
            async function (scope) {
                const cwd = await realpath(await mkdtemp(join(tmpdir(), 'overkill-stryker-catalog-')));
                scope.cleanup(async function removeProject() {
                    await rm(cwd, { recursive: true, force: true });
                });
                const output = await executeMutationScript(strykerCatalogScript, [
                    adapterUrl,
                    engineUrl,
                    configUrl,
                    processModel,
                    String(freshState),
                    restriction,
                    import.meta.resolve('@stryker-mutator/api/test-runner')
                ], cwd);
                scope.assert.equal(output, 'catalog passed\n');
                return scope.assert.collect();
            }
        );
    })
);

await runIfMain(import.meta, testNode, { reporters: [ createLineReporter() ] });
