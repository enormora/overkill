import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import {
    calibrationReferenceReportArtifact,
    readCalibrationReferenceReport,
    type CalibrationReferenceReport
} from './calibration-report.ts';

export const testNode = suite('calibration operation reporting', [
    test('ignores reports supplied by benchmark cases', function (scope: TestScope) {
        const result = runResultFactory.build({});
        const report: CalibrationReferenceReport = {
            version: 1,
            changes: [ { kind: 'write', path: 'calibration/reference.json' } ],
            completed: [ 'calibration/reference.json' ],
            outcome: 'written'
        };
        const artifact = calibrationReferenceReportArtifact({
            result,
            report,
            maxBytes: 4096,
            capturedAtMicroseconds: 0
        });
        const supplied = {
            ...artifact,
            id: {
                ...artifact.id,
                attempt: { index: 0 },
                scope: {
                    kind: 'case' as const,
                    activeCases: [],
                    case: { file: 'reference.bench.ts', suite: [], title: 'reference', params: null },
                    confidence: 'active-case' as const
                }
            }
        };
        scope.assert.equal(readCalibrationReferenceReport({ ...result, artifacts: [ supplied ] }), null);
        const retained = readCalibrationReferenceReport({ ...result, artifacts: [ supplied, artifact ] });
        scope.require.defined(retained);
        scope.assert.deepEqual(retained, report);
        return scope.assert.collect();
    })
]);
