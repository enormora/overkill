import { createDeterministicClock } from '@enormora/clock';
import { createReporterDispatcher } from '../engine/reporter-dispatcher.ts';
import type { RunResult } from '../engine/run-result.ts';
import type { CalibrationSnapshot } from '../engine/benchmark-result.ts';
import type { StoredCalibration } from '../baselines/calibration-reference.ts';
import { createCalibrationCaptureSession } from '../run/calibration-capture-session.ts';
import type { RunResultSession } from '../run/run-support.ts';
import { benchmarkHtmlFixture } from './benchmark-html-fixture.ts';
import { calibrationSnapshot } from './calibration-fixture.ts';

const referenceSample = 42;
type CalibrationCaptureFixture = {
    readonly result: RunResult;
    readonly session: RunResultSession;
    readonly written: readonly CalibrationSnapshot[];
    readonly owners: readonly StoredCalibration['owners'][];
};
export function calibrationCapture(failure: Error | null, maxBytes: number): CalibrationCaptureFixture {
    const written: CalibrationSnapshot[] = [];
    const owners: StoredCalibration['owners'][] = [];
    const wallClock = createDeterministicClock({ initialUnixEpochMicroseconds: 0n });
    const result = benchmarkHtmlFixture('calibration capture');
    const snapshot = calibrationSnapshot([ referenceSample ]);
    const session = createCalibrationCaptureSession({
        profile: 'unit',
        maxBytes,
        dependencies: {
            wallClock,
            reporterDispatcher: createReporterDispatcher({
                wallClock,
                stdout: {
                    writeLine() {
                        return undefined;
                    }
                },
                stderr: {
                    writeLine() {
                        return undefined;
                    }
                }
            })
        },
        store: {
            async list() {
                return [];
            },
            async remove() {
                throw new Error('Capture must not prune references.');
            },
            pathOf(reference) {
                return `${reference.profile}/reference.json`;
            },
            async write(_profile, snapshots, owner) {
                if (failure !== null) {
                    throw failure;
                }
                written.push(...snapshots);
                owners.push(...snapshots.map(owner));
                return [ 'unit/reference.json' ];
            }
        }
    });
    return {
        session,
        written,
        owners,
        result: {
            ...result,
            artifacts: [],
            perTest: result.perTest.map(function (test) {
                if (test.benchmark === null) {
                    throw new Error('Expected benchmark result.');
                }
                return {
                    ...test,
                    benchmark: {
                        ...test.benchmark,
                        normalization: {
                            version: 1,
                            comparability: { kind: 'comparable' },
                            calibrations: [ snapshot, snapshot ],
                            metrics: {}
                        }
                    }
                };
            })
        }
    };
}
