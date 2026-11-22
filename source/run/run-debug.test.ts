import { suite, test } from '@overkill-dev/test';

import { defaultRunRequest, defaultMicrotestProfile } from '../test-support/run-command-factory.ts';
import { createDefaultWorkId } from '../engine/identity.ts';

import { parseDebugRequest, resolveDebugSelection } from './run-debug.ts';
import { parseReplayDebugArguments } from './replay-debug-arguments.ts';
import { copyRunRequest } from './request-snapshot.ts';
import { resolveRunRecordPersistence } from './run-profile-facts.ts';

export const testNode = suite('debug requests', [
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
