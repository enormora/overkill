import { createSuite } from '../../../packages/engine/engine.entry-point.ts';
import { testNode as processPolicyObservationTestNode } from '../../../run/process-policy-observation.test.ts';
import { testNode as fileModuleBoundaryTestNode } from '../../../run/file-module-boundary.test.ts';
import { testNode as collectedRunPolicyTestNode } from '../../../run/collected-run-policy.test.ts';
import { testNode as runnerPropertyPolicyTestNode } from '../../run/runner-property-policy.test.ts';
import { testNode as runnerCapabilityPolicyTestNode } from '../../run/runner-capability-policy.test.ts';
import { testNode as runnerPermissionAuditTestNode } from '../../run/runner-permission-audit.test.ts';
import { testNode as runnerProcessPolicyTestNode } from '../../run/runner-process-policy.test.ts';

export const testNode = createSuite({
    title: 'runner policy integration',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [
        processPolicyObservationTestNode,
        fileModuleBoundaryTestNode,
        collectedRunPolicyTestNode,
        runnerPropertyPolicyTestNode,
        runnerCapabilityPolicyTestNode,
        runnerPermissionAuditTestNode,
        runnerProcessPolicyTestNode
    ]
});
