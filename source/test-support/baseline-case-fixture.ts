import { createCaseId, createDefaultWorkId } from '../engine/identity.ts';
import type { BaselineCaseEnd } from '../run/baseline-outcomes.ts';
import type { StoredOrdinaryBaseline } from '../run/baseline-record.ts';
import { runResultFactory } from './run-result-factory.ts';

export const baselineCaseEvent: BaselineCaseEnd = {
    kind: 'test-end',
    attempt: 0,
    case: createCaseId('output.test.ts', [], 'output', null),
    definitionLocations: [ { kind: 'unknown' } ],
    suitePath: [],
    artifacts: [],
    property: null,
    benchmark: null,
    completion: 'final',
    durationMicroseconds: 0,
    outcome: { kind: 'pass' },
    verdict: 'pass'
};
export const storedBaseline: StoredOrdinaryBaseline = {
    version: 1,
    adapter: 'output',
    profile: 'unit',
    subtype: 'content-snapshot',
    comparisonContext: {},
    work: createDefaultWorkId(baselineCaseEvent.case),
    payload: { kind: 'text', text: '42' }
};
export const baselineCaseResult = runResultFactory.build({
    perTest: [ { id: baselineCaseEvent.case, verdict: 'pass' } ],
    summary: { planned: 1, passed: 1 },
    planStatus: 'planned',
    status: 'passed'
});
