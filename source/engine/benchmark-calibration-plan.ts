import type { TestPlan } from './test-plan.ts';
import { readTestBodyResourceAttachments } from './test-body-resource-attachment.ts';
import { readBenchmarkCalibrationBody } from './benchmark-node.ts';

export class BenchmarkCalibrationPlanError extends TypeError {
    public constructor(message: string, options: Readonly<ErrorOptions>) {
        super(message, options);
        this.name = 'BenchmarkCalibrationPlanError';
    }
}

export function calibrationCapturePlan(testPlan: TestPlan, capture: boolean): TestPlan {
    if (!capture) {
        return testPlan;
    }
    const captureCase = function captureCase(testCase: TestPlan['cases'][number]): TestPlan['cases'][number] {
        const { execution } = testCase;
        if (execution.kind !== 'body' || execution.bodyMode !== 'benchmark') {
            return testCase;
        }
        const calibration = readBenchmarkCalibrationBody(execution.body);
        if (calibration === null) {
            throw new BenchmarkCalibrationPlanError(
                'Benchmark does not expose calibration resource execution.',
                { cause: null }
            );
        }
        return {
            ...testCase,
            resourceAttachments: readTestBodyResourceAttachments(calibration.resourceBody),
            execution: { ...execution, body: calibration.body, resourceBody: calibration.resourceBody }
        };
    };
    const [ first, ...rest ] = testPlan.cases;
    return { ...testPlan, cases: [ captureCase(first), ...rest.map(captureCase) ] };
}
