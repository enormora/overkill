import { type TestNode, suite, test } from '@overkill-dev/test';

import { createDefaultWorkId } from '../engine/identity.ts';

import type { FailedCheck, RunResult, TestOutcome } from '../packages/engine/engine.entry-point.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import type { RunRecordTestOutcome } from './run-record-outcomes.ts';
import { recordedRunResult, serializeRunDiagnostics, parseSerializedRunDiagnostics } from './run-record-result.ts';

function findings(): readonly [FailedCheck, ...readonly FailedCheck[]] {
    const outcome = runResultFactory
        .build({
            perTest: [ {
                outcome: { kind: 'fail', checks: [ { summary: 'first finding' }, { summary: 'second finding' } ] }
            } ]
        })
        .perTest[0]
        ?.outcome;
    if (outcome?.kind !== 'fail' || outcome.failures[0].kind !== 'assertion') {
        throw new Error('Expected assertion evidence.');
    }
    return outcome.failures[0].checks;
}
function caseWithFindings(outcome: TestOutcome): RunResult {
    const base = runResultFactory.build({
        summary: { planned: 1, failed: 1 },
        perTest: [ { outcome: { kind: 'fail' } } ]
    });
    const selected = base.perTest[0];
    if (selected === undefined) {
        throw new Error('Expected a selected case.');
    }
    return { ...base, perTest: [ { ...selected, outcome } ] };
}
function nestedFindings(): RunResult {
    const checks = findings();
    const owner = { run: 'record', id: 'service', scope: 'per-run' } as const;
    const [ first, ...remaining ] = checks.map(function finding(check, index) {
        return { target: index === 0 ? 'primary' : null, check };
    });
    if (first === undefined) {
        throw new Error('Expected resource findings.');
    }
    const evidence = {
        owner,
        resource: 'service',
        interval: { kind: 'lifetime' as const },
        failures: [ first, ...remaining ]
    };
    const composite: FailedCheck = { ...checks[0], kind: 'composite', children: checks };
    const outcome: TestOutcome = {
        kind: 'fail',
        failures: [ { kind: 'assertion', checks: [ composite, ...checks ] }, {
            kind: 'resource-check',
            ...evidence,
            interval: {
                kind: 'attempt',
                work: createDefaultWorkId({ file: null, suite: [], title: 'consumer', params: null }),
                attempt: { index: 0 }
            },
            failures: [ first, ...remaining ]
        } ]
    };
    return {
        ...caseWithFindings(outcome),
        resourceChecks: [ { ...evidence, revision: 1, passing: 0, errors: [], status: { kind: 'complete' } } ]
    };
}
type FindingSummary = { readonly target: string | null; readonly summary: string; };
type OutcomeFindings = {
    readonly assertions: readonly string[];
    readonly children: readonly string[];
    readonly resources: readonly FindingSummary[];
};
type FailedRecordedOutcome = Extract<RunRecordTestOutcome, { readonly kind: 'fail'; }>;
function failureGroups(outcome: RunRecordTestOutcome | null | undefined): FailedRecordedOutcome['failures'] {
    if (outcome?.kind !== 'fail') {
        throw new Error('Expected failed recorded outcome.');
    }
    return outcome.failures;
}
function outcomeFindings(outcome: RunRecordTestOutcome | null | undefined): OutcomeFindings {
    const [ assertion, resource ] = failureGroups(outcome);
    if (assertion.kind !== 'assertion' || resource?.kind !== 'resource-check') {
        throw new Error('Expected assertion and resource evidence.');
    }
    const composite = assertion.checks[0];
    if (composite.kind !== 'composite') {
        throw new Error('Expected composite assertion evidence.');
    }
    return {
        assertions: assertion.checks.map(function summary(check) {
            return check.summary;
        }),
        children: composite.children.map(function summary(check) {
            return check.summary;
        }),
        resources: resource.failures.map(function summary(finding) {
            return { target: finding.target, summary: finding.check.summary };
        })
    };
}
export const testNode: TestNode = suite('recorded nested findings', [
    test('preserves every composite child, assertion check, and resource finding', function (scope) {
        const live = nestedFindings();
        const recorded = recordedRunResult(live);
        scope.assert.deepEqual(outcomeFindings(recorded.perTest[0]?.outcome), {
            assertions: [ 'first finding', 'first finding', 'second finding' ],
            children: [ 'first finding', 'second finding' ],
            resources: [ { target: 'primary', summary: 'first finding' }, { target: null, summary: 'second finding' } ]
        });
        scope.assert.deepEqual<unknown, unknown>(
            recorded.resourceChecks[0]?.failures.map(function finding(value) {
                return [ value.target, value.check.summary ];
            }),
            [ [ 'primary', 'first finding' ], [ null, 'second finding' ] ]
        );
        const encoded = JSON.stringify(serializeRunDiagnostics(live));
        const restored = parseSerializedRunDiagnostics(JSON.parse(encoded));
        scope.assert.deepEqual<unknown, unknown>(
            restored.resourceChecks[0]?.failures.map(function finding(value) {
                return [ value.target, value.check.summary ];
            }),
            [ [ 'primary', 'first finding' ], [ null, 'second finding' ] ]
        );
        return scope.assert.collect();
    })
]);
