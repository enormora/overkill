import assert from 'node:assert/strict';
import { z } from 'zod/v4';

export const mutationCoverageModes = [ 'perTest', 'all', 'off' ] as const;
export type MutationCoverageMode = typeof mutationCoverageModes[number];
const positionSchema = z.strictObject({ line: z.number().int().positive(), column: z.number().int().nonnegative() });
export const campaignEvidenceSchema = z.strictObject({
    coverage: z.enum(mutationCoverageModes),
    durationMicroseconds: z.number().int().nonnegative(),
    tests: z.array(z.strictObject({ id: z.string(), name: z.string(), status: z.enum([ 'success', 'skipped' ]) })),
    mutants: z.array(z.strictObject({
        file: z.string(),
        location: z.strictObject({ start: positionSchema, end: positionSchema }),
        mutator: z.string(),
        replacement: z.string(),
        status: z.enum([ 'Killed', 'Survived', 'NoCoverage' ]),
        killers: z.array(z.string()),
        testsCompleted: z.number().int().nonnegative()
    }))
});
export type CampaignEvidence = z.infer<typeof campaignEvidenceSchema>;
type ExpectedMutant = {
    readonly file: string;
    readonly line: number;
    readonly status: 'Killed' | 'Survived' | 'NoCoverage';
    readonly killers: readonly string[];
    readonly optimizedCases: number;
};
export const expectedMutationManifest: readonly ExpectedMutant[] = [
    { file: 'disjoint.mjs', line: 1, status: 'Killed', killers: [ 'disjoint first' ], optimizedCases: 1 },
    { file: 'disjoint.mjs', line: 2, status: 'Killed', killers: [ 'disjoint second' ], optimizedCases: 1 },
    { file: 'shared.mjs', line: 1, status: 'Killed', killers: [ 'shared first', 'shared second' ], optimizedCases: 2 },
    { file: 'survivor.mjs', line: 1, status: 'Survived', killers: [], optimizedCases: 1 },
    { file: 'uncovered.mjs', line: 1, status: 'NoCoverage', killers: [], optimizedCases: 0 },
    { file: 'static.mjs', line: 1, status: 'Killed', killers: [ 'static' ], optimizedCases: 9 },
    { file: 'hybrid.mjs', line: 1, status: 'Killed', killers: [ 'hybrid' ], optimizedCases: 9 },
    { file: 'parameter.mjs', line: 1, status: 'Killed', killers: [ 'parameter 1', 'parameter 2' ], optimizedCases: 2 }
];

function mutantKey(mutant: CampaignEvidence['mutants'][number]): string {
    return JSON.stringify([ mutant.file, mutant.location, mutant.mutator, mutant.replacement ]);
}

function validateCampaign(evidence: CampaignEvidence): void {
    const tests = new Map(evidence.tests.map((test) => [ test.id, test ]));
    assert.equal(tests.size, evidence.tests.length, 'Duplicate test identity');
    assert.equal(evidence.tests.length, 10, 'Incomplete dry-run catalog');
    assert.equal(evidence.tests.filter((test) => test.status === 'skipped').length, 1);
    assert.equal(evidence.mutants.length, expectedMutationManifest.length, 'Mutant inventory changed');
    assert.equal(new Set(evidence.mutants.map(mutantKey)).size, evidence.mutants.length, 'Duplicate mutant');
    for (const expected of expectedMutationManifest) {
        const matches = evidence.mutants.filter((mutant) =>
            mutant.file === expected.file && mutant.location.start.line === expected.line
        );
        assert.equal(matches.length, 1, `Missing or repeated mutant: ${expected.file}:${expected.line}`);
        const [ mutant ] = matches;
        assert.ok(mutant);
        assert.equal(mutant.mutator, 'BooleanLiteral');
        assert.equal(mutant.replacement, 'false');
        const status = expected.status === 'NoCoverage' && evidence.coverage === 'off' ? 'Survived' : expected.status;
        assert.equal(mutant.status, status, mutantKey(mutant));
        const executed = evidence.coverage === 'perTest' ?
            expected.optimizedCases
            : status === 'NoCoverage'
            ? 0
            : evidence.tests.filter((test) => test.status === 'success').length;
        assert.equal(mutant.testsCompleted, executed, `Incorrect selection: ${mutantKey(mutant)}`);
        for (const killer of mutant.killers) {
            assert.ok(tests.has(killer), `Killer outside dry-run catalog: ${killer}`);
        }
        const expectedKillers = expected.killers.map((title) => {
            const matching = evidence.tests.filter((test) => test.name.split(' > ').includes(title));
            assert.equal(matching.length, 1, `Ambiguous expected killer: ${title}`);
            const [ test ] = matching;
            assert.ok(test);
            return test.id;
        });
        assert.deepEqual(mutant.killers.toSorted(), expectedKillers.toSorted(), mutantKey(mutant));
    }
}

export function compareMutationCampaigns(evidence: readonly CampaignEvidence[]): void {
    const [ baseline ] = evidence;
    assert.ok(baseline, 'Campaign evidence is empty');
    for (const campaign of evidence) {
        validateCampaign(campaign);
        assert.deepEqual(
            campaign.tests.toSorted((left, right) => left.id.localeCompare(right.id)),
            baseline.tests.toSorted((left, right) => left.id.localeCompare(right.id))
        );
        assert.deepEqual(campaign.mutants.map(mutantKey).toSorted(), baseline.mutants.map(mutantKey).toSorted());
    }
}
