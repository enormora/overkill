import {
    defineTestFamily,
    singleAttemptResult,
    type TestFamily,
    type FamilyPreparation,
    type FamilyPreparationInput,
    type FamilyCollection,
    type FamilyAnalysisContext,
    type WorkId
} from '../packages/engine/engine.entry-point.ts';

export type EvidenceMode = 'complete' | 'duplicate' | 'missing' | 'setup-error';
type RecordEvent = (event: string) => void;

async function reportCase(context: FamilyAnalysisContext, workId: WorkId, mode: EvidenceMode): Promise<boolean> {
    await context.report({ kind: 'case-start', workId });
    if (mode === 'duplicate') {
        await context.report({ kind: 'case-start', workId });
        return false;
    }
    if (mode !== 'missing') {
        await context.report({
            kind: 'case-end',
            artifacts: [],
            result: singleAttemptResult({
                id: workId.case,
                workId,
                definitionLocations: [ { kind: 'unknown' } ],
                outcome: { kind: 'pass' },
                verdict: 'pass',
                durationMicroseconds: 1
            }, { index: 0 })
        });
    }
    return true;
}

function analysisCollection(record: RecordEvent, mode: EvidenceMode, workIds: readonly WorkId[]): FamilyCollection {
    record('collect');
    return {
        kind: 'analysis',
        facts: { selected: workIds.length },
        async execute(context) {
            record('execute');
            for (const workId of workIds.toReversed()) {
                if (!await reportCase(context, workId, mode)) {
                    return;
                }
            }
        }
    };
}

function analysisPreparation(
    record: RecordEvent,
    mode: EvidenceMode,
    input: FamilyPreparationInput<null>
): FamilyPreparation {
    record('prepare');
    if (mode === 'setup-error') {
        throw new Error('Checker setup failed.');
    }
    return {
        testPlan: input.testPlan,
        facts: { prepared: true },
        async dispose() {
            record('dispose');
        },
        async collect({ workIds }) {
            return analysisCollection(record, mode, workIds);
        }
    };
}

export function analysisFixture(record: RecordEvent, mode: EvidenceMode): TestFamily<null> {
    return defineTestFamily({
        id: '@example/analysis',
        version: '1',
        module: null,
        features: { execution: 'analysis', processModels: [ 'in-process' ], profileOptions: [] },
        parseSettings(input) {
            if (input !== null) {
                throw new TypeError('Expected null settings.');
            }
            return null;
        },
        async load() {
            record('load');
            return {
                async prepare(input) {
                    return analysisPreparation(record, mode, input);
                }
            };
        }
    });
}
