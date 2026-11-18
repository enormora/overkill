import { testNode as hostObserver } from '../../run/benchmark-host-observer-policy.test.ts';
import { createSuite } from '../../packages/engine/engine.entry-point.ts';
import { testNode as run } from '../../run/run.test.ts';
import { testNode as runCustomEngine } from '../../run/run-custom-engine.test.ts';
import { testNode as runSelection } from '../../run/run-selection.test.ts';
import { testNode as runOrdering } from '../../run/run-ordering.test.ts';
import { testNode as runCoverageRequest } from '../../run/run-coverage-request.test.ts';
import { testNode as runValidation } from '../../run/run-validation.test.ts';
import { testNode as familyProfilePolicy } from '../../run/family-profile-policy.test.ts';
import { testNode as mutationExecutionPolicy } from '../../packages/stryker-runner/mutation-execution-policy.test.ts';

export const testNode = createSuite({
    title: 'runner policy and selection',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [
        run,
        hostObserver,
        runCustomEngine,
        runSelection,
        runOrdering,
        runCoverageRequest,
        runValidation,
        familyProfilePolicy,
        mutationExecutionPolicy
    ]
});
