import type { MutantRunOptions } from '@stryker-mutator/api/test-runner';
import { workIdentityKey, type RunExecutionReply } from '../packages/run/run.entry-point.ts';
import { campaignBaselineSchema, type CampaignBaseline } from '../packages/stryker-runner/mutation-catalog.ts';
import { runResultFactory } from './run-result-factory.ts';

type MutationCoverageFixture = {
    readonly baseline: CampaignBaseline;
    readonly reply: Extract<RunExecutionReply, { readonly kind: 'result'; }>;
    readonly options: Readonly<MutantRunOptions>;
};

export function mutationCoverageFixture(
    coverageAnalysis: CampaignBaseline['coverageAnalysis']
): MutationCoverageFixture {
    const result = runResultFactory.build({
        perTest: [ 'first', 'second', 'unrelated' ].map(function passingCase(title) {
            return { id: { file: `${title}.test.ts`, suite: [], title, params: null }, outcome: { kind: 'pass' } };
        })
    });
    const catalog = result.perTest.map(function catalogEntry(testCase) {
        return {
            id: workIdentityKey(testCase.workId),
            work: testCase.workId,
            annotations: { ownership: [], tags: [] },
            controls: { capture: null, duplicateExecution: null, timeoutMilliseconds: null },
            skipReason: null
        };
    });
    const baseline = campaignBaselineSchema.parse({
        catalog,
        coverageAnalysis,
        coverage: {
            static: {},
            perTest: Object.fromEntries(
                catalog
                    .filter(function instrumentedCase(entry) {
                        return entry.work.case.title !== 'unrelated';
                    })
                    .map(function coveringCase(entry, index) {
                        return [ entry.id, { mutant: index + 1 } ];
                    })
            )
        }
    });
    const identities = catalog.map(function testIdentity(entry) {
        return entry.id;
    });
    return {
        baseline,
        reply: {
            kind: 'result',
            result,
            deadlineExceeded: false,
            data: {
                catalog,
                coverage: baseline.coverage,
                selected: identities,
                completed: identities,
                bailed: false,
                hitLimitExceeded: false
            }
        },
        options: {
            activeMutant: {
                id: 'mutant',
                fileName: 'subject.ts',
                mutatorName: 'BooleanLiteral',
                replacement: 'false',
                location: { start: { line: 0, column: 0 }, end: { line: 0, column: 4 } }
            },
            mutantActivation: 'runtime',
            reloadEnvironment: false,
            sandboxFileName: '/project/subject.ts',
            timeout: 30_000,
            disableBail: true
        }
    };
}
