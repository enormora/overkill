import { defineResource } from '@overkill-dev/test/resources';
import { createTestFacade, table, suite, test } from '@overkill-dev/test';

import { z } from 'zod/v4';
import {
    mutationModes,
    sourceMutationModules
} from '../runtime/fixtures/mutation-evidence/mutation-project.test.ts';
import {
    compareMutationCampaigns,
    mutationCoverageModes,
    type CampaignEvidence
} from '../runtime/fixtures/mutation-evidence/mutation-accuracy.test.ts';
import { mutationCacheScript } from '../runtime/fixtures/mutation-evidence/mutation-cache.test.ts';
import { executeMutationScript } from '../runtime/support/stryker-script.ts';
import { captureMutationCampaign, verifyMutationAccuracy } from './support/mutation-accuracy-driver.ts';

const projectUrl = new URL(
    '../runtime/fixtures/mutation-evidence/mutation-project.test.ts',
    import.meta.url
);
const mutations: readonly { readonly title: string; readonly corrupt: (evidence: CampaignEvidence) => void; }[] = [
    {
        title: 'missing mutant',
        corrupt(evidence) {
            evidence.mutants.pop();
        }
    },
    {
        title: 'incorrect mutation status',
        corrupt(evidence) {
            const mutant = evidence.mutants.find(function (value) {
                return value.status === 'Killed';
            });
            if (mutant !== undefined) {
                mutant.status = 'Survived';
            }
        }
    },
    {
        title: 'killer outside the test catalog',
        corrupt(evidence) {
            const mutant = evidence.mutants.find(function (value) {
                return value.status === 'Killed';
            });
            mutant?.killers.push('outside-catalog');
        }
    },
    {
        title: 'false absence of coverage',
        corrupt(evidence) {
            const mutant = evidence.mutants.find(function (value) {
                return value.file === 'survivor.mjs';
            });
            if (mutant !== undefined) {
                mutant.status = 'NoCoverage';
            }
        }
    },
    {
        title: 'duplicate mutant identity',
        corrupt(evidence) {
            const [ mutant ] = evidence.mutants;
            if (mutant !== undefined) {
                evidence.mutants.push(mutant);
            }
        }
    },
    {
        title: 'incomplete execution',
        corrupt(evidence) {
            const [ mutant ] = evidence.mutants;
            if (mutant !== undefined) {
                mutant.testsCompleted += 1;
            }
        }
    }
];

const campaignRequests = mutationModes.flatMap(function executionModes(mode) {
    return [ '42', '314159' ].flatMap(function seeds(seed) {
        return [ 1, 2 ].map(function repetitions(repetition) {
            return { mode, seed, repetition };
        });
    });
});

const evidenceCases = createTestFacade({
    resources: {
        baseline: defineResource({
            name: 'mutation campaign baseline',
            scope: 'per-suite',
            requirements: [],
            dispose: null,
            async acquire() {
                return await captureMutationCampaign(
                    sourceMutationModules,
                    { processModel: 'in-process', freshState: false },
                    '42',
                    'perTest'
                );
            }
        })
    }
});

export const testNode = suite('mutation campaign accuracy', [
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
    }),
    evidenceCases.table({
        title: 'rejects corrupted campaign evidence',
        cases: mutations,
        caseTitle({ title }) {
            return title;
        },
        test(scope) {
            const { baseline } = scope.resources;
            const changed = structuredClone(baseline);
            scope.parameters.corrupt(changed);
            scope.assert.throws(function () {
                compareMutationCampaigns([ baseline, changed ]);
            }, { name: 'AssertionError' });
            return scope.assert.collect();
        }
    }),
    test('rejects an empty campaign comparison', function (scope) {
        scope.assert.throws(function () {
            compareMutationCampaigns([]);
        }, { name: 'AssertionError' });
        return scope.assert.collect();
    }),
    table({
        title: 'documents fresh-state cache limitations',
        cases: mutationModes,
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
