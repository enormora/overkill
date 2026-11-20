import { type TestNode, suite, test } from '@overkill-dev/test';

import type { FailedCheck } from '../packages/engine/engine.entry-point.ts';
import type { RunResult, PropertyCaseEvidence } from '../engine/run-result.ts';
import type { CoverageArtifact } from '../engine/coverage-artifact.ts';
import { createReportingContext } from '../engine/reporting-context.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { briefSummaryIntents, briefFailureIntents } from './brief-reporter-rendering.ts';

function failedCheck(): FailedCheck {
    const outcome = runResultFactory
        .build({ perTest: [ { outcome: { kind: 'fail', checks: [ { summary: 'unhealthy' } ] } } ] })
        .perTest[0]
        ?.outcome;
    if (outcome?.kind !== 'fail' || outcome.failures[0].kind !== 'assertion') {
        throw new Error('Expected failed assertion evidence.');
    }
    return outcome.failures[0].checks[0];
}
function summaryEvidence(): RunResult {
    const coverage: CoverageArtifact = {
        id: {
            attempt: null,
            familyVariant: null,
            runtimes: [],
            workload: null,
            scope: { kind: 'run' },
            sequence: 0,
            subtype: 'coverage'
        },
        source: 'v8-native',
        payload: {
            kind: 'coverage',
            completeness: 'complete',
            directory: 'coverage-output',
            rawDataDirectory: 'raw-coverage',
            reports: [],
            summary: {
                lines: { covered: 1, total: 2 },
                functions: { covered: 2, total: 2 },
                branches: { covered: 0, total: 1 }
            }
        }
    };
    const property: PropertyCaseEvidence = {
        invocations: [ {
            identity: 'policy',
            summary: null,
            confirmedWitness: null,
            shrinkStatus: 'shrinking-disabled',
            original: null,
            retained: null,
            diagnostics: [ { reason: 'execution-error', observation: null }, {
                reason: 'execution-error',
                observation: null
            } ]
        } ]
    };
    const base = runResultFactory.build({
        summary: { planned: 1, passed: 1 },
        perTest: [ { id: { file: null, suite: [], title: 'policy case', params: null }, outcome: { kind: 'pass' } } ],
        artifacts: [ coverage ]
    });
    return {
        ...base,
        perTest: base.perTest.map(function retainEvidence(result) {
            return { ...result, property };
        })
    };
}
export const testNode: TestNode = suite('brief final evidence rendering', [
    test('renders property diagnostics and collected unit coverage summaries', function (scope) {
        const lines = briefSummaryIntents(summaryEvidence()).map(function text(intent) {
            return intent.text;
        });
        scope.assert.true(lines.includes('policy case: Property policy: Execution error during shrinking (2)'));
        scope.assert.true(lines.includes('policy case: Property policy: Shrinking is disabled (1)'));
        scope.assert.true(lines.includes('Coverage output: coverage-output'));
        scope.assert.true(lines.some(function coverage(line) {
            return line.startsWith('Coverage: lines ');
        }));
        return scope.assert.collect();
    }),
    test('renders every lifetime resource finding with its target', function (scope) {
        const check = failedCheck();
        const result: RunResult = {
            ...runResultFactory.build({}),
            resourceChecks: [ {
                owner: { run: 'run', id: 'owner', scope: 'per-run' },
                resource: 'service',
                revision: 1,
                interval: { kind: 'lifetime' },
                passing: 0,
                failures: [ { target: 'primary', check }, { target: null, check } ],
                errors: [],
                status: { kind: 'complete' }
            } ]
        };
        const lines = briefFailureIntents(result, createReportingContext({ projectRoot: null })).map(
            function text(intent) {
                return intent.text;
            }
        );
        scope.assert.deepEqual(lines, [ 'fail service (primary): unhealthy', 'fail service: unhealthy' ]);
        return scope.assert.collect();
    })
]);
