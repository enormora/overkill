import { suite } from '@overkill-dev/test';

import { testNode as referenced } from './referenced-resource-composition.test.ts';
import { testNode as resourceBindingExecutionTestNode } from './resource-binding-execution.test.ts';
import { testNode as resourceLifecycleScopesTestNode } from './resource-lifecycle-scopes.test.ts';
import { testNode as scenarioAttachmentMetadataTestNode } from './scenario-attachment-metadata.test.ts';
import { testNode as simulationSubpathTestNode } from './simulation-subpath.test.ts';

export const testNode = suite('source/packages/test/resource-suite.test.ts', [
    referenced,
    resourceBindingExecutionTestNode,
    resourceLifecycleScopesTestNode,
    scenarioAttachmentMetadataTestNode,
    simulationSubpathTestNode
]);
