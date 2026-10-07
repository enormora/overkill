import { closeSync } from 'node:fs';
import { observeProcessExit } from '../../../run/node-process-policy-observation.ts';
const operation = process.argv[2];
const stop = observeProcessExit(function record(message) {
    if (operation === 'record-failure') { throw new Error('failed to record'); }
    return {
        attributedTo: operation === 'bounded' ? { file: 'fixture.test.ts', params: null, suite: [], title: 'x'.repeat(10000) } : null,
        attributedToAttempt: operation === 'attributed' ? { index: 3 } : null, attributedToWork: null, cause: null, diagnostics: [], message, subtype: 'runtime-policy'
    };
});
if (operation === 'completed') { stop(); }
if (operation === 'stderr-failure') { closeSync(2); }
if (operation === 'natural') { await new Promise(() => {}); }
else { process.exit(operation === 'nonzero' ? 7 : 0); }
