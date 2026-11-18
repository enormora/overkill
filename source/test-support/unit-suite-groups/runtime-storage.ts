import { testNode as control } from '../../engine/async-control-policy.test.ts';
import { testNode as participants } from '../../engine/body-participant-policy.test.ts';
import { testNode as owners } from '../../engine/resource-owner-policy.test.ts';
import { testNode as completion } from '../../engine/resource-owner-completion.test.ts';
import { testNode as evidence } from '../../engine/failure-evidence-policy.test.ts';
import { testNode as observation } from '../../engine/observation-lifetime-policy.test.ts';
import { createSuite } from '../../packages/engine/engine.entry-point.ts';
import { testNode as files } from '../../atomic-file-store-policy.test.ts';
import { testNode as requests } from '../../run/run-serial-request.test.ts';

export const testNode = createSuite({
    title: 'runtime state and request contracts',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [ control, participants, owners, completion, evidence, observation, files, requests ]
});
