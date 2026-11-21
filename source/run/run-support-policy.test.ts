import { suite, test } from '@overkill-dev/test';

import type { TestRuntimePolicy } from '../engine/case-execution-context.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { readBenchmarkRunMetadata } from '../bench/benchmark-run-report.ts';
import { metadataCommand } from './benchmark-report-metadata.test.ts';
import {
    composeRunRuntimePolicies,
    assertReplaySelection,
    propertyReplayContext,
    withRunErrorMetadata
} from './run-support.ts';

const transparentPolicy: TestRuntimePolicy = {
    resourceChecks() {
        return [];
    },
    async prepareAttempt() {
        return undefined;
    },
    async completeCase() {
        return undefined;
    },
    async runAttempt(_testCase, _attempt, operation) {
        return await operation();
    },
    async runLoad(operation) {
        return await operation();
    },
    takeAttemptErrors() {
        return [];
    },
    takePendingRunErrors() {
        return [];
    },
    takeRunErrors() {
        return [];
    }
};
export const testNode = suite('run support policy boundaries', [
    test('preserves a lone runtime policy on either side of composition', function (scope) {
        scope.assert.equal(composeRunRuntimePolicies(transparentPolicy, null), transparentPolicy);
        scope.assert.equal(composeRunRuntimePolicies(null, transparentPolicy), transparentPolicy);
        scope.assert.equal(composeRunRuntimePolicies(null, null), null);
        return scope.assert.collect();
    }),
    test('requires executable selection when witness context is present', function (scope) {
        const command = Object.assign(metadataCommand('supervised-process'), {
            propertyReplay: { retained: 'witness' }
        });
        scope.assert.throws(function () {
            assertReplaySelection(command, false);
        }, { message: 'Witness replay requires exactly one executable property case.' });
        assertReplaySelection(command, true);
        scope.assert.deepEqual<unknown, unknown>(propertyReplayContext(command), {
            propertyReplay: command.propertyReplay
        });
        scope.assert.deepEqual(propertyReplayContext(metadataCommand('supervised-process')), {});
        return scope.assert.collect();
    }),
    test('attaches benchmark collection failure metadata through run finalization', async function (scope) {
        const command = metadataCommand('supervised-process');
        const result = await withRunErrorMetadata(runResultFactory.build(), command, null);
        scope.assert.equal(readBenchmarkRunMetadata(result.preparationFacts)?.execution.profile, 'startup');
        scope.assert.equal(result.artifacts.length, 0);
        return scope.assert.collect();
    })
]);
