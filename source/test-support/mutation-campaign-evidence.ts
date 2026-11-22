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
export type CampaignEvidence = Readonly<z.infer<typeof campaignEvidenceSchema>>;
type ExpectedMutant = {
    readonly file: string;
    readonly line: number;
    readonly status: 'Killed' | 'NoCoverage' | 'Survived';
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

type Mutant = Readonly<CampaignEvidence['mutants'][number]>;
type CampaignTest = Readonly<CampaignEvidence['tests'][number]>;

function mutantKey(mutant: Mutant): string {
    return JSON.stringify([ mutant.file, mutant.location, mutant.mutator, mutant.replacement ]);
}

function testIdentity(test: CampaignTest): string {
    return test.id;
}

function compareText(left: string, right: string): number {
    return left.localeCompare(right);
}

function compareTestIds(left: CampaignTest, right: CampaignTest): number {
    return compareText(left.id, right.id);
}

function expectedKillerIds(tests: readonly CampaignTest[], titles: readonly string[]): readonly string[] {
    return titles.map(function killerId(title) {
        const matching = tests.filter(function matchesTitle(test) {
            return test.name.split(' > ').includes(title);
        });
        const [ test ] = matching;
        assert.ok(test !== undefined && matching.length === 1, `Ambiguous expected killer: ${title}`);
        return test.id;
    });
}

function expectedStatus(expected: ExpectedMutant, coverage: MutationCoverageMode): Mutant['status'] {
    return expected.status === 'NoCoverage' && coverage === 'off' ? 'Survived' : expected.status;
}

function expectedCompletedCases(
    expected: ExpectedMutant,
    coverage: MutationCoverageMode,
    successfulTests: number
): number {
    if (coverage === 'perTest') {
        return expected.optimizedCases;
    }
    return expectedStatus(expected, coverage) === 'NoCoverage' ? 0 : successfulTests;
}

function matchingMutant(mutants: readonly Mutant[], expected: ExpectedMutant): Mutant {
    const matches = mutants.filter(function matchesExpected(mutant) {
        return mutant.file === expected.file && mutant.location.start.line === expected.line;
    });
    const [ mutant ] = matches;
    assert.ok(
        mutant !== undefined && matches.length === 1,
        `Missing or repeated mutant: ${expected.file}:${expected.line}`
    );
    return mutant;
}

function validateMutant(
    evidence: CampaignEvidence,
    expected: ExpectedMutant,
    successfulTests: number,
    testIds: ReadonlySet<string>
): void {
    const mutant = matchingMutant(evidence.mutants, expected);
    const key = mutantKey(mutant);
    assert.equal(mutant.mutator, 'BooleanLiteral');
    assert.equal(mutant.replacement, 'false');
    assert.equal(mutant.status, expectedStatus(expected, evidence.coverage), key);
    assert.equal(
        mutant.testsCompleted,
        expectedCompletedCases(expected, evidence.coverage, successfulTests),
        `Incorrect selection: ${key}`
    );
    assert.ok(
        mutant.killers.every(function knownKiller(id) {
            return testIds.has(id);
        }),
        'Killer outside dry-run catalog'
    );
    assert.deepEqual(
        mutant.killers.toSorted(compareText),
        expectedKillerIds(evidence.tests, expected.killers).toSorted(compareText),
        key
    );
}

function validateCampaign(evidence: CampaignEvidence): void {
    const testIds = new Set(evidence.tests.map(testIdentity));
    const mutantIds = new Set(evidence.mutants.map(mutantKey));
    const successfulTests = evidence
        .tests
        .filter(function successful(test) {
            return test.status === 'success';
        })
        .length;
    assert.equal(testIds.size, evidence.tests.length, 'Duplicate test identity');
    assert.equal(evidence.tests.length, 10, 'Incomplete dry-run catalog');
    assert.equal(evidence.tests.length - successfulTests, 1);
    assert.equal(evidence.mutants.length, expectedMutationManifest.length, 'Mutant inventory changed');
    assert.equal(mutantIds.size, evidence.mutants.length, 'Duplicate mutant');
    for (const expected of expectedMutationManifest) {
        validateMutant(evidence, expected, successfulTests, testIds);
    }
}

export function compareMutationCampaigns(evidence: readonly CampaignEvidence[]): void {
    const [ baseline ] = evidence;
    assert.ok(baseline !== undefined, 'Campaign evidence is empty');
    for (const campaign of evidence) {
        validateCampaign(campaign);
        assert.deepEqual(campaign.tests.toSorted(compareTestIds), baseline.tests.toSorted(compareTestIds));
        assert.deepEqual(
            campaign.mutants.map(mutantKey).toSorted(compareText),
            baseline.mutants.map(mutantKey).toSorted(compareText)
        );
    }
}
