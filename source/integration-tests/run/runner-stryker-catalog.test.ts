import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, suite as authoredSuite } from '@overkill-dev/test';

import { adapterUrl, engineUrl, configUrl } from './stryker-lifecycle-fixture.test.ts';
import { executeMutationScript } from './stryker-script.test.ts';
import { strykerCatalogScript } from './stryker-catalog-scripts.test.ts';

const modes = ([ 'in-process', 'supervised-process' ] as const).flatMap(function processModes(processModel) {
    return [ false, true ].flatMap(function stateModes(freshState) {
        return [ 'all-files', 'listed-files', 'skips' ].map(function restrictions(restriction) {
            return { processModel, freshState, restriction };
        });
    });
});

export const testNode = authoredSuite(
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
