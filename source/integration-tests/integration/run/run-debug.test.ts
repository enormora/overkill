import { type TestNode, table, type TestScope, suite, test } from '@overkill-dev/test';

import { defaultRunRequest, defaultMicrotestProfile } from '../../../test-support/run-command-factory.ts';
import { passingResult, runCommandLine } from '../../../test-support/command-line-test-driver.ts';
import { createDefaultWorkId } from '../../../engine/identity.ts';

import { parseDebugRequest, resolveDebugSelection } from '../../../run/run-debug.ts';
import { parseReplayDebugArguments } from '../../../run/replay-debug-arguments.ts';
import { copyRunRequest } from '../../../run/request-snapshot.ts';
import { resolveRunRecordPersistence } from '../../../run/run-profile-facts.ts';

export const testNode: TestNode = suite('debug requests', [
    test(
        'standalone debug scopes preserve selection and repeated selectors',
        async function (scope: TestScope) {
            const result = await runCommandLine(
                [ 'run', '--debug-scope', 'title=first', '--debug-scope', 'title=second' ],
                passingResult()
            );
            scope.assert.deepEqual(result.exitCodes, [ 0 ]);
            const request = result.runRequests[0]?.runRequest;
            scope.require.defined(request);
            scope.assert.deepEqual(request.debug, { mode: 'selected', selectors: [ 'title=first', 'title=second' ] });
            scope.assert.deepEqual(request.selection, { kind: 'all' });
            return scope.assert.collect();
        }
    ),
    test('debug all is accepted by ordinary and benchmark run commands', async function (scope: TestScope) {
        const ordinary = await runCommandLine([ 'run', '--debug' ], passingResult());
        const benchmark = await runCommandLine([ 'bench', 'run', '--debug' ], passingResult());
        scope.assert.deepEqual(ordinary.exitCodes, [ 0 ]);
        const request = ordinary.runRequests[0];
        scope.require.defined(request);
        scope.assert.deepEqual(request.runRequest.debug, { mode: 'all', selectors: [] });
        scope.assert.deepEqual(benchmark.exitCodes, [ 0 ]);
        return scope.assert.collect();
    }),
    table({
        title: 'reports invalid debug arguments as usage errors',
        cases: [
            [ 'run', '--debug', '--debug-scope', 'title=case' ],
            [ 'run', '--debug-scope', 'invalid' ],
            [ 'run', '--debug-scope', '' ],
            [ 'run', '--debug-scope' ]
        ],
        caseTitle(args) {
            return `${JSON.stringify(args)}`;
        },
        async test(scope) {
            const args = scope.parameters;

            const result = await runCommandLine(args, passingResult());
            scope.assert.deepEqual(result.exitCodes, [ 3 ]);
            scope.assert.equal(result.runRequests.length, 0);
            return scope.assert.collect();
        }
    }),
    test(
        'request snapshots copy selector arrays and debug activates record persistence',
        function (scope) {
            const selectors: [string, ...string[]] = [ 'title=case' ];
            const request = defaultRunRequest({ debug: { mode: 'selected', selectors } });
            const copied = copyRunRequest(request);
            selectors.push('title=other');
            scope.assert.deepEqual(copied.debug, { mode: 'selected', selectors: [ 'title=case' ] });
            scope.assert.deepEqual(resolveRunRecordPersistence(copied, defaultMicrotestProfile({})), {
                persist: true,
                reasons: [ 'debug' ]
            });
            return scope.assert.collect();
        }
    ),
    test('replay debug flags are explicit and leave operands intact', function (scope) {
        scope.assert.deepEqual(parseReplayDebugArguments([ 'run-id' ]), {
            debug: { mode: 'off', selectors: [] },
            operands: [ 'run-id' ]
        });
        scope.assert.deepEqual(parseReplayDebugArguments([ 'run-id', '--debug' ]), {
            debug: { mode: 'all', selectors: [] },
            operands: [ 'run-id' ]
        });
        scope.assert.deepEqual(parseDebugRequest(false, []), { mode: 'off', selectors: [] });
        return scope.assert.collect();
    }),
    test('a case matching multiple debug selectors is captured once', function (scope) {
        const cases = [ 'matching', 'ordinary' ].map(function candidate(title) {
            const id = { file: 'cases.test.ts', params: null, suite: [], title };
            return { id, annotations: { ownership: [], tags: [] }, workId: createDefaultWorkId(id) };
        });
        const debug = parseDebugRequest(false, [ 'title=missing', 'title~match', 'title=matching' ]);
        scope.assert.deepEqual(resolveDebugSelection(debug, cases), {
            mode: 'selected',
            work: cases.slice(0, 1).map(function (candidate) {
                return candidate.workId;
            })
        });
        return scope.assert.collect();
    }),
    test('replay rejects conflicting debug options before reading history', function (scope) {
        scope.assert.throws(function parseConflictingOptions() {
            parseReplayDebugArguments([ 'run-id', '--debug', '--debug-scope', 'title=case' ]);
        }, { message: '--debug and --debug-scope are mutually exclusive.' });
        return scope.assert.collect();
    })
]);
