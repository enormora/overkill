import { table, type TestNode, suite, test } from '@overkill-dev/test';

import { runResultFactory } from '../../test-support/run-result-factory.ts';
import { exchangedAttachment } from '../../test-support/attachment-exchange.ts';
import { serializeRunDiagnostics } from '../run/run.entry-point.ts';

import { mutationDiagnosticEvidence } from './mutation-diagnostic-evidence.ts';
import { mutationLifecycleDataSchema } from './mutation-catalog.ts';

const project = '/sandbox/project';
const caseId = { file: '/sandbox/project/source/failure.test.ts', suite: [], title: 'failure', params: null };
const workId = { familyVariant: null, case: caseId, runtimes: [], workload: null };
export const testNode: TestNode = suite('mutation diagnostic evidence identity', [
    test('canonicalizes failed case and attributed runner-error identities', function (scope) {
        const result = runResultFactory.build({
            perTest: [ { id: caseId, workId, verdict: 'fail' } ],
            runnerErrors: [ { attributedTo: caseId, attributedToWork: workId, message: 'failed' } ]
        });
        const diagnostics = mutationDiagnosticEvidence(project, {
            kind: 'result',
            result,
            data: null,
            deadlineExceeded: false
        });
        scope.assert.partialDeepEqual(diagnostics.perTest, [ {
            id: { file: 'source/failure.test.ts' },
            workId: { case: { file: 'source/failure.test.ts' } }
        } ]);
        scope.assert.partialDeepEqual(diagnostics.runnerErrors, [ {
            attributedTo: { file: 'source/failure.test.ts' },
            attributedToWork: { case: { file: 'source/failure.test.ts' } }
        } ]);
        return scope.assert.collect();
    }),
    test('preserves null error attribution and omits passing and skipped cases', function (scope) {
        const result = runResultFactory.build({
            perTest: [ { id: caseId, workId, verdict: 'pass' }, { id: { ...caseId, title: 'skip' }, verdict: 'skip' } ],
            runnerErrors: [ { attributedTo: null, attributedToWork: null, message: 'run failure' } ]
        });
        const diagnostics = mutationDiagnosticEvidence(project, {
            kind: 'result',
            result,
            data: null,
            deadlineExceeded: false
        });
        scope.assert.deepEqual(diagnostics.perTest, []);
        scope.assert.partialDeepEqual(diagnostics.runnerErrors, [ {
            attributedTo: null,
            attributedToWork: null,
            message: 'run failure'
        } ]);
        return scope.assert.collect();
    }),
    test('canonicalizes case-scoped artifact identities and their active cases', function (scope) {
        const artifact = {
            ...exchangedAttachment,
            id: {
                ...exchangedAttachment.id,
                attempt: { index: 0 },
                scope: {
                    kind: 'case' as const,
                    confidence: 'active-case' as const,
                    case: caseId,
                    activeCases: [ caseId ]
                }
            }
        };
        const result = runResultFactory.build({ artifacts: [ artifact, exchangedAttachment ] });
        const diagnostics = mutationDiagnosticEvidence(project, {
            kind: 'result',
            result,
            data: null,
            deadlineExceeded: false
        });
        scope.assert.partialDeepEqual(diagnostics.artifacts, [ {
            id: {
                scope: {
                    kind: 'case',
                    case: { file: 'source/failure.test.ts' },
                    activeCases: [ { file: 'source/failure.test.ts' } ]
                }
            }
        }, { id: { scope: { kind: 'run' } } } ]);
        return scope.assert.collect();
    }),
    test('uses checkpoint diagnostics when a result is unavailable', function (scope) {
        const result = runResultFactory.build({ perTest: [ { id: caseId, workId, verdict: 'fail' } ] });
        const diagnostics = mutationDiagnosticEvidence(project, {
            kind: 'timeout',
            artifacts: [],
            data: mutationLifecycleDataSchema.parse({
                catalog: [],
                coverage: { static: {}, perTest: {} },
                selected: [],
                completed: [],
                bailed: false,
                caseFailures: [],
                infrastructureErrors: [],
                hitLimitExceeded: false,
                diagnostics: serializeRunDiagnostics(result)
            })
        });
        scope.assert.partialDeepEqual(diagnostics.perTest, [ { id: { file: 'source/failure.test.ts' } } ]);
        return scope.assert.collect();
    }),
    table({
        title: 'handles missing checkpoint evidence',
        cases: [ null, { kind: 'timeout', artifacts: [], data: null }, {
            kind: 'timeout',
            artifacts: [],
            data: { invalid: true }
        } ] as const,
        caseTitle(_parameters, index) {
            return `${index}`;
        },
        test(scope) {
            const reply = scope.parameters;

            scope.assert.deepEqual(mutationDiagnosticEvidence(project, reply), {
                artifacts: [],
                resourceChecks: [],
                perTest: [],
                runnerErrors: []
            });
            return scope.assert.collect();
        }
    })
]);
