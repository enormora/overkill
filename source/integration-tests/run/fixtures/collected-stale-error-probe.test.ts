import assert from 'node:assert/strict';
import { collectLifecycleRun, collectedRunCommand } from '../../../test-support/collected-run-fixtures.ts';

const { collected, state } = await collectLifecycleRun(collectedRunCommand());
const originalRun = await collected.run({ selection: { kind: 'all' } });
assert.equal(originalRun.status, 'passed');
const raisePreviousError = state.raiseLateError;
const started = Promise.withResolvers<undefined>();
const gate = Promise.withResolvers<undefined>();
state.notifyStarted = function notifyStarted() { started.resolve(undefined); };
state.gate = gate.promise;
const running = collected.run({ selection: { kind: 'all' } });
await started.promise;
raisePreviousError();
gate.resolve(undefined);
const failed = await running;
const error = failed.runnerErrors.find(function previousInvocationError(candidate) {
    return candidate.message.includes('previous invocation rejection');
});
assert.equal(failed.status, 'failed');
assert.ok(error);
assert.equal(error.attributedTo, null);
assert.equal(error.attributedToWork, null);
assert.equal(error.subtype, 'attribution-drift');
const origin = originalRun.perTest.at(-1);
assert.ok(origin);
assert.partialDeepStrictEqual(error.cause, {
    origin: { case: origin.id, work: origin.workId, attempt: { index: 0 } }
});
state.gate = null;
state.notifyStarted = function noNotification() { return undefined; };
const recovered = await collected.run({ selection: { kind: 'all' } });
assert.equal(recovered.status, 'passed');
assert.deepEqual(recovered.runnerErrors, []);
process.stdout.write('collected late error attribution passed\n');
