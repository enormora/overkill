import { suite, table } from '@overkill-dev/test';
import { mutationCoverageModes } from '../../test-support/mutation-campaign-evidence.ts';
import {
    mutationModes,
    sourceMutationModules
} from '../runtime/fixtures/mutation-evidence/mutation-project.test.ts';
import { verifyMutationAccuracy } from './support/mutation-accuracy-driver.ts';

const campaignRequests = mutationModes.flatMap(function executionModes(mode) {
    return [ '42', '314159' ].flatMap(function seeds(seed) {
        return [ 1, 2 ].map(function repetitions(repetition) {
            return { mode, seed, repetition };
        });
    });
});

export const testNode = suite('mutation campaign accuracy matrix', [
    table({
        title: 'preserves mutation accuracy across execution modes, seeds, and repetitions',
        cases: campaignRequests,
        caseTitle({ mode, seed, repetition }) {
            return `${mode.processModel}, fresh state ${
                String(mode.freshState)
            }, seed ${seed}, repetition ${repetition}`;
        },
        async test(scope) {
            const { mode, seed } = scope.parameters;
            const evidence = await verifyMutationAccuracy(sourceMutationModules, mode, seed, mutationCoverageModes);
            scope.assert.equal(
                evidence
                    .flatMap(function (campaign) {
                        return campaign.mutants;
                    })
                    .filter(function (mutant) {
                        return mutant.status === 'Killed';
                    })
                    .length,
                18
            );
            return scope.assert.collect();
        }
    })
]);
