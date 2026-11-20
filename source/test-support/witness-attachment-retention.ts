import type { TestScope } from '@overkill-dev/test';
import type { RunResult, PropertyCaseEvidence, PerTestResult } from '../engine/run-result.ts';
import { defaultAttachmentLimits } from '../engine/runtime-attachment.ts';
import { createAttachmentExecution, type AttachmentExecution } from '../run/attachment-execution.ts';
import type { AttachmentOperation } from '../run/attachment-protocol.ts';
import { recordAttachmentExchange } from './attachment-exchange.ts';
import { propertyCorpusEntry } from './property-corpus.ts';
import { runResultFactory } from './run-result-factory.ts';

type WitnessAttachmentRetention = {
    readonly result: RunResult;
    readonly execution: AttachmentExecution;
    readonly operations: readonly AttachmentOperation[];
};
export function confirmedWitnessResult(confirmed: boolean): RunResult {
    const result = runResultFactory.build({
        status: 'failed',
        summary: { planned: 1, passed: 0, failed: 1 },
        perTest: [ { id: propertyCorpusEntry.case, verdict: 'fail', outcome: { kind: 'fail' } } ]
    });
    const property: PropertyCaseEvidence = {
        invocations: [ {
            summary: null,
            identity: 'unit-property',
            confirmedWitness: confirmed ? propertyCorpusEntry : null,
            shrinkStatus: 'shrinking-disabled',
            diagnostics: [],
            original: null,
            retained: null
        } ]
    };
    return {
        ...result,
        perTest: result.perTest.map(function attachWitnessEvidence(testCase): PerTestResult {
            const [ first, ...remaining ] = testCase.attempts;
            return {
                ...testCase,
                property,
                attempts: [
                    { ...first, property },
                    ...remaining.map(function attachAttemptEvidence(attempt) {
                        return { ...attempt, property };
                    })
                ]
            };
        })
    };
}
export function witnessAttachmentRetention(scope: TestScope, failure: Error | null): WitnessAttachmentRetention {
    const recorded = recordAttachmentExchange();
    const execution = createAttachmentExecution(async function exchange(operation) {
        if (failure !== null) {
            throw failure;
        }
        return await recorded.exchange(operation);
    }, defaultAttachmentLimits);
    scope.cleanup(async function finishWitnessExecution() {
        await execution.finish();
    });
    return { result: confirmedWitnessResult(true), execution, operations: recorded.operations };
}
