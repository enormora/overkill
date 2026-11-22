import { table, suite, test } from '@overkill-dev/test';
import { z } from 'zod/v4';
import {
    sourceMutationModules,
    type MutationMode
} from '../runtime/fixtures/mutation-evidence/mutation-project.test.ts';
import { compareMutationCampaigns } from '../../test-support/mutation-campaign-evidence.ts';
import { mutationCacheScript } from '../runtime/fixtures/mutation-evidence/mutation-cache.test.ts';
import { executeMutationScript } from '../runtime/support/stryker-script.ts';
import { captureMutationCampaign } from './support/mutation-accuracy-driver.ts';

const projectUrl = new URL(
    '../runtime/fixtures/mutation-evidence/mutation-project.test.ts',
    import.meta.url
);
const cacheModes: readonly MutationMode[] = [
    { processModel: 'in-process', freshState: false },
    { processModel: 'in-process', freshState: true },
    { processModel: 'supervised-process', freshState: false }
];

export const testNode = suite('mutation campaign accuracy', [
    test('preserves mutant classification and test identity across execution models', async function (scope) {
        const reused = await captureMutationCampaign(
            sourceMutationModules,
            { processModel: 'in-process', freshState: false },
            '42',
            'perTest'
        );
        const fresh = await captureMutationCampaign(
            sourceMutationModules,
            { processModel: 'supervised-process', freshState: true },
            '42',
            'off'
        );

        compareMutationCampaigns([ reused, fresh ]);
        scope.assert.deepEqual(
            [ reused, fresh ].map(evidence => evidence.mutants.filter(mutant => mutant.status === 'Killed').length),
            [ 6, 6 ]
        );
        return scope.assert.collect();
    }),
    table({
        title: 'documents fresh-state cache limitations',
        cases: cacheModes,
        caseTitle(mode) {
            return `${mode.processModel}, ${String(mode.freshState)}`;
        },
        async test(scope) {
            const mode = scope.parameters;

            const output = await executeMutationScript(mutationCacheScript, [
                projectUrl.href,
                JSON.stringify([ sourceMutationModules, mode ])
            ], process.cwd());
            const result = z
                .strictObject({
                    status: z.enum([ 'survived', 'killed' ]),
                    testsCompleted: z.literal(1)
                })
                .parse(JSON.parse(output));
            scope.assert.equal(
                result.status,
                mode.freshState || mode.processModel === 'supervised-process'
                    ? 'killed'
                    : 'survived'
            );
            return scope.assert.collect();
        }
    })
]);
