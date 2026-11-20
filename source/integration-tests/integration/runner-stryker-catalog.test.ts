import { table, type TestNode, suite } from '@overkill-dev/test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { adapterUrl, engineUrl, configUrl } from './support/stryker-lifecycle-fixture.ts';
import { executeMutationScript } from './support/stryker-script.ts';
import { strykerCatalogScript } from './support/stryker-catalog-scripts.ts';

const modes = ([ 'in-process', 'supervised-process' ] as const).flatMap(function processModes(processModel) {
    return [ false, true ].flatMap(function stateModes(freshState) {
        return [ 'all-files', 'listed-files', 'skips' ].map(function restrictions(restriction) {
            return { processModel, freshState, restriction };
        });
    });
});

export const testNode: TestNode = suite(
    'Stryker catalog execution',
    [ table({
        title: 'freshState freezes the catalog',
        cases: modes,
        caseTitle({ processModel, freshState, restriction }) {
            return `${processModel} freshState ${String(freshState)} ${restriction} freezes the catalog`;
        },
        async test(scope) {
            const { processModel, freshState, restriction } = scope.parameters;

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
    }) ]
);
