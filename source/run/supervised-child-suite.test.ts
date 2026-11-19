import { suite } from '@overkill-dev/test';

import { testNode as hostFamilyTestNode } from './host-family-plan.test.ts';
import { testNode as reporterFlushTestNode } from './supervised-reporter-flush.test.ts';
import { testNode as definitionLocationsTestNode } from './supervised-definition-locations.test.ts';
import { testNode as supervisedChildProcessTestNode } from './supervised-child-process.test.ts';
import { testNode as nativeArtifactsTestNode } from './supervised-native-artifacts.test.ts';

export const testNode = suite('source/run/supervised-child-suite.test.ts', [
    hostFamilyTestNode,
    reporterFlushTestNode,
    definitionLocationsTestNode,
    nativeArtifactsTestNode,
    supervisedChildProcessTestNode
]);
