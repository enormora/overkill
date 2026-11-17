import { runIfMain } from '#test-runner';
import { createSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as evidencePolicy } from './brief-evidence-policy.test.ts';
import { testNode as liveTests } from './brief-reporter.test.ts';
import { testNode as finalTests } from './brief-final-result-reporter.test.ts';

export const testNode = createSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'brief reporters',
    children: [
        evidencePolicy,
        liveTests,
        finalTests
    ]
});

await runIfMain(import.meta, testNode);
