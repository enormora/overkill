import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import { resolvePropertyPolicy } from './property-policy.ts';
import type { PropertyPolicy } from './property-node.ts';
import type { TestPlan, TestPlanCase } from './test-plan.ts';

export class PropertyPlanError extends TypeError {
    public constructor(message: string, options: Readonly<ErrorOptions>) {
        super(message, options);
        this.name = 'PropertyPlanError';
    }
}
export function validatePropertyControls(testCase: Pick<TestPlanCase, 'controls'>, softMilliseconds: number): void {
    const { capture, timeoutMilliseconds } = testCase.controls;
    if (capture !== null) {
        throw new PropertyPlanError('Run profile "property" cannot run test cases with authored capture controls.', {
            cause: null
        });
    }
    if (
        timeoutMilliseconds !== null &&
        (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds <= 0 ||
            timeoutMilliseconds > softMilliseconds)
    ) {
        throw new PropertyPlanError(
            [
                `Run profile "property" cannot run test case timeoutMilliseconds ${timeoutMilliseconds};`,
                `expected positive safe integer <= ${softMilliseconds}.`
            ]
                .join(' '),
            { cause: null }
        );
    }
}

function requiresPropertyDeclaration(testCase: TestPlanCase): boolean {
    return testCase.testFamily === 'property' && testCase.execution.kind !== 'skip';
}

function resolvePropertyCase(testCase: TestPlanCase, defaults: PropertyPolicy, softMilliseconds: number): TestPlanCase {
    validatePropertyControls(testCase, softMilliseconds);
    const { execution } = testCase;
    if (execution.kind !== 'body' || execution.bodyMode !== 'property') {
        if (requiresPropertyDeclaration(testCase)) {
            throw new PropertyPlanError('Property test case requires a collected property declaration.', {
                cause: null
            });
        }
        return testCase;
    }
    try {
        const policy = resolvePropertyPolicy(defaults, execution.definition);
        return { ...testCase, execution: { ...execution, policy: { kind: 'resolved', policy } } };
    } catch (error: unknown) {
        throw new PropertyPlanError(
            `Invalid property policy for "${testCase.id.title}": ${
                error instanceof Error ? error.message : String(error)
            }`,
            { cause: error }
        );
    }
}

export function resolveTestPlanPropertyPolicy(
    testPlan: TestPlan,
    defaults: PropertyPolicy,
    softMilliseconds: number
): TestPlan {
    function resolveCases(cases: NonEmptyReadonlyArray<TestPlanCase>): NonEmptyReadonlyArray<TestPlanCase> {
        return [
            resolvePropertyCase(cases[0], defaults, softMilliseconds),
            ...cases.slice(1).map(function resolveCase(testCase) {
                return resolvePropertyCase(testCase, defaults, softMilliseconds);
            })
        ];
    }
    return {
        ...testPlan,
        discoveredCases: resolveCases(testPlan.discoveredCases),
        cases: resolveCases(testPlan.cases)
    };
}
