import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import type { HttpTranscriptEntry, TranscriptCaptureErrorEntry } from '../transcript/http-transcript.ts';

type ScenarioContext = { readonly scenario: string | null; };
type ScenarioObservation = {
    readonly count: number;
    readonly entry: HttpTranscriptEntry<ScenarioContext> | TranscriptCaptureErrorEntry | null;
};
type ExpectedScenario = { readonly count: number; readonly scenario: string; readonly url: string | null; };

export const httpScenarioEvidence = defineCompositeAssertion({
    name: 'HTTP transcripts retain scenario ownership',
    assert(check, observed: ScenarioObservation, expected: ExpectedScenario) {
        const { entry } = observed;
        if (entry === null) {
            return check.defined(entry);
        }
        if (entry[0] !== 'http') {
            return check.equal(entry[0], 'http');
        }
        const url = expected.url === null ? [] : [ check.equal(entry[1].request.url, expected.url) ];
        return check.group([
            check.equal(observed.count, expected.count),
            check.deepEqual(entry[1].context, { scenario: expected.scenario }),
            ...url
        ]);
    }
});
