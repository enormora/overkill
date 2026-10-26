import { runIfMain } from '#test-runner';
import { z } from 'zod/v4';
import { suite, test } from '../../packages/test/test.entry-point.ts';
import { mutationModes, sourceMutationModules } from './fixtures/mutation-evidence/mutation-project.test.ts';
import { captureMutationCampaign, verifyMutationAccuracy } from './mutation-accuracy-driver.test.ts';
import {
    compareMutationCampaigns,
    mutationCoverageModes,
    type CampaignEvidence
} from './fixtures/mutation-evidence/mutation-accuracy.test.ts';
import { mutationCacheScript } from './fixtures/mutation-evidence/mutation-cache.test.ts';
import { executeMutationScript } from './stryker-script.test.ts';

const extension = import.meta.url.endsWith('.ts') ? 'ts' : 'js';
const projectUrl = new URL(`./fixtures/mutation-evidence/mutation-project.test.${extension}`, import.meta.url);
const mutations: readonly ((evidence: CampaignEvidence) => void)[] = [
    function missingMutant(evidence) {
        evidence.mutants.pop();
    },
    function wrongStatus(evidence) {
        const mutant = evidence.mutants.find(function (value) {
            return value.status === 'Killed';
        });
        if (mutant !== undefined) {
            mutant.status = 'Survived';
        }
    },
    function invalidKiller(evidence) {
        const mutant = evidence.mutants.find(function (value) {
            return value.status === 'Killed';
        });
        mutant?.killers.push('outside-catalog');
    },
    function falseNoCoverage(evidence) {
        const mutant = evidence.mutants.find(function (value) {
            return value.file === 'survivor.mjs';
        });
        if (mutant !== undefined) {
            mutant.status = 'NoCoverage';
        }
    },
    function duplicateIdentity(evidence) {
        const [ mutant ] = evidence.mutants;
        if (mutant !== undefined) {
            evidence.mutants.push(mutant);
        }
    },
    function incompleteExecution(evidence) {
        const [ mutant ] = evidence.mutants;
        if (mutant !== undefined) {
            mutant.testsCompleted += 1;
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
const campaigns = campaignRequests.map(function campaignCase({ mode, seed, repetition }) {
    return test(
        `${mode.processModel} freshState ${String(mode.freshState)} seed ${seed} repetition ${repetition}`,
        async function (scope) {
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
    );
});

export const testNode = suite('mutation campaign accuracy', [
    ...campaigns,
    test('rejects incomplete and incorrectly attributed campaign evidence', async function (scope) {
        const baseline = await captureMutationCampaign(
            sourceMutationModules,
            { processModel: 'in-process', freshState: false },
            '42',
            'perTest'
        );
        for (const corrupt of mutations) {
            const changed = structuredClone(baseline);
            corrupt(changed);
            scope.assert.throws(function () {
                compareMutationCampaigns([ baseline, changed ]);
            }, { name: 'AssertionError' });
        }
        scope.assert.throws(function () {
            compareMutationCampaigns([]);
        }, { name: 'AssertionError' });
        return scope.assert.collect();
    }),
    ...mutationModes.map(function cacheModes(mode) {
        return test(
            `${mode.processModel} freshState ${String(mode.freshState)} cache limitation`,
            async function (scope) {
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
        );
    })
]);

await runIfMain(import.meta, testNode);
