import { type TestNode, suite, test } from '@overkill-dev/test';

import { CalibrationPublicationError } from '../baselines/calibration-store.ts';
import { readCalibrationReferenceReport } from '../bench/calibration-report.ts';
import { calibrationCapture } from '../test-support/calibration-capture.ts';

export const testNode: TestNode = suite('calibration capture publication', [
    test('deduplicates references and records their consuming work', async function (scope) {
        const fixture = calibrationCapture(null, 4096);
        const result = await fixture.session.finalize(fixture.result);
        scope.assert.equal(fixture.session.prepareResult(fixture.result), fixture.result);
        scope.assert.equal(fixture.written.length, 1);
        scope.assert.deepEqual(fixture.owners, [ fixture.result.perTest.map(function (entry) {
            return entry.workId;
        }) ]);
        scope.assert.equal(readCalibrationReferenceReport(result)?.outcome, 'written');
        scope.assert.deepEqual<unknown, unknown>(readCalibrationReferenceReport(result)?.completed, [
            'unit/reference.json'
        ]);
        return scope.assert.collect();
    }),
    test('does not publish references after an unsuccessful execution', async function (scope) {
        const fixture = calibrationCapture(null, 4096);
        const result = await fixture.session.finalize({ ...fixture.result, status: 'failed' });
        scope.assert.deepEqual(fixture.written, []);
        scope.assert.equal(readCalibrationReferenceReport(result)?.outcome, 'blocked');
        return scope.assert.collect();
    }),
    test('finishes an empty capture without writing a reference', async function (scope) {
        const fixture = calibrationCapture(null, 4096);
        const result = await fixture.session.finalize({ ...fixture.result, perTest: [] });
        scope.assert.deepEqual(fixture.written, []);
        scope.assert.deepEqual<unknown, unknown>(readCalibrationReferenceReport(result)?.completed, []);
        return scope.assert.collect();
    }),
    test('retains publication failures in the execution result', async function (scope) {
        const fixture = calibrationCapture(new Error('Publication failed.'), 4096);
        const result = await fixture.session.finalize(fixture.result);
        scope.assert.equal(result.status, 'failed');
        scope.assert.includes(JSON.stringify(result.runnerErrors), 'Publication failed.');
        scope.assert.equal(readCalibrationReferenceReport(result)?.outcome, 'failed');
        scope.assert.deepEqual<unknown, unknown>(readCalibrationReferenceReport(result)?.completed, []);
        return scope.assert.collect();
    }),
    test('preserves completed paths after a partial publication failure', async function (scope) {
        const fixture = calibrationCapture(
            new CalibrationPublicationError('Partial publication.', {
                cause: new Error('Storage failed.'),
                completed: [ 'unit/previous.json' ]
            }),
            4096
        );
        const result = await fixture.session.finalize(fixture.result);
        scope.assert.equal(result.status, 'failed');
        scope.assert.deepEqual<unknown, unknown>(readCalibrationReferenceReport(result)?.completed, [
            'unit/previous.json'
        ]);
        return scope.assert.collect();
    }),
    test('reports oversized evidence without publishing references', async function (scope) {
        const fixture = calibrationCapture(null, 1);
        const result = await fixture.session.finalize(fixture.result);
        scope.assert.equal(result.status, 'failed');
        scope.assert.deepEqual(fixture.written, []);
        scope.assert.equal(readCalibrationReferenceReport(result), null);
        return scope.assert.collect();
    })
]);
