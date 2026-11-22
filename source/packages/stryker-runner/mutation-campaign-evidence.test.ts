import { suite, table, test } from '@overkill-dev/test';
import {
    compareMutationCampaigns,
    expectedMutationManifest,
    type CampaignEvidence
} from '../../test-support/mutation-campaign-evidence.ts';

const successfulTests = [
    'disjoint first', 'disjoint second', 'shared first', 'shared second', 'covered survivor',
    'static', 'hybrid', 'parameter 1', 'parameter 2'
];
const column = 26;

function campaignEvidence(): CampaignEvidence {
    return {
        coverage: 'perTest',
        durationMicroseconds: 0,
        tests: [
            ...successfulTests.map(function successful(name) {
                return { id: name, name, status: 'success' as const };
            }),
            { id: 'skip', name: 'intentional skip', status: 'skipped' }
        ],
        mutants: expectedMutationManifest.map(function mutant({ file, line, status, killers, optimizedCases }) {
            return {
                file,
                location: { start: { line, column }, end: { line, column: column + 4 } },
                mutator: 'BooleanLiteral',
                replacement: 'false',
                status,
                killers: [ ...killers ],
                testsCompleted: optimizedCases
            };
        })
    };
}

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

export const testNode = suite('mutation campaign evidence', [
    table({
        title: 'rejects corrupted campaign evidence',
        cases: mutations,
        caseTitle({ title }) {
            return title;
        },
        test(scope) {
            const baseline = campaignEvidence();
            compareMutationCampaigns([ baseline ]);
            const changed = structuredClone(baseline);
            scope.parameters.corrupt(changed);
            scope.assert.throws(function corruptedCampaign() {
                compareMutationCampaigns([ baseline, changed ]);
            }, { name: 'AssertionError' });
            return scope.assert.collect();
        }
    }),
    test('rejects an empty campaign comparison', function (scope) {
        scope.assert.throws(function emptyCampaign() {
            compareMutationCampaigns([]);
        }, { name: 'AssertionError' });
        return scope.assert.collect();
    })
]);
