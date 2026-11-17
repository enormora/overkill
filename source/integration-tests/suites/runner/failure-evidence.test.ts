import { createSuite } from '../../../packages/engine/engine.entry-point.ts';
import { testNode as integrationFailureArtifacts } from '../../../run/integration-failure-artifacts.test.ts';
import { testNode as failureArtifactSharing } from '../../../run/failure-artifact-sharing.test.ts';
import { testNode as resourceFailurePreparation } from '../../../run/resource-failure-preparation.test.ts';
import { testNode as processFailureEvidence } from '../../../run/process-failure-evidence.test.ts';

export const testNode = createSuite({
    title: 'failure evidence integration',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [
        integrationFailureArtifacts,
        failureArtifactSharing,
        resourceFailurePreparation,
        processFailureEvidence
    ]
});
