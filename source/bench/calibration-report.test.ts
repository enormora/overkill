import { type TestNode, type TestScope, suite, test } from '@overkill-dev/test';

import { runResultFactory } from '../test-support/run-result-factory.ts';
import {
    withCalibrationReferenceReport,
    readCalibrationReferenceReport,
    type CalibrationReferenceReport
} from './calibration-report.ts';

export const testNode: TestNode = suite('calibration operation reporting', [
    test('retains reference changes as typed evidence without attachments', function (scope: TestScope) {
        const result = runResultFactory.build({});
        const report: CalibrationReferenceReport = {
            changes: [ { kind: 'write', path: 'calibration/reference.json' } ],
            completed: [ 'calibration/reference.json' ],
            outcome: 'written'
        };
        scope.assert.equal(readCalibrationReferenceReport(result), null);
        const updated = withCalibrationReferenceReport({ result, report, maxBytes: 4096 });
        const retained = readCalibrationReferenceReport(updated);
        scope.require.defined(retained);
        scope.assert.deepEqual(retained, report);
        scope.assert.deepEqual(updated.artifacts, []);
        scope.assert.throws(function oversizedReport() {
            withCalibrationReferenceReport({ result, report, maxBytes: 1 });
        }, { message: 'Calibration reference report exceeds the configured byte limit.' });
        return scope.assert.collect();
    })
]);
