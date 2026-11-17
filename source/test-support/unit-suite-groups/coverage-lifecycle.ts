import { testNode as recordPolicy } from '../../run/run-record-policy.test.ts';
import { testNode as recordReasons } from '../../run/run-record-reasons.test.ts';
import { createSuite } from '../../packages/engine/engine.entry-point.ts';
import { testNode as runLocalCoverage } from '../../run/run-local-coverage.test.ts';
import { testNode as recordedCoverageSession } from '../../run/recorded-coverage-session.test.ts';
import { testNode as runResultFinalization } from '../../run/run-result-finalization.test.ts';

export const testNode = createSuite({
    title: 'coverage recording lifecycle',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [
        recordPolicy,
        recordReasons,
        runLocalCoverage,
        recordedCoverageSession,
        runResultFinalization
    ]
});
