import { suite } from '@overkill-dev/test';

import { testNode as integrationFailureArtifacts } from '../../../run/integration-failure-artifacts.test.ts';
import { testNode as failureArtifactSharing } from '../../../run/failure-artifact-sharing.test.ts';
import { testNode as resourceFailurePreparation } from '../../../run/resource-failure-preparation.test.ts';
import { testNode as processFailureEvidence } from '../../../run/process-failure-evidence.test.ts';

export const testNode = suite('failure evidence integration', [
    integrationFailureArtifacts,
    failureArtifactSharing,
    resourceFailurePreparation,
    processFailureEvidence
]);
