type TestContractFailureCodeByName = {
    readonly deadBuilderAssertion: 'dead-builder-assertion';
    readonly invalidAssertionReference: 'invalid-assertion-reference';
    readonly invalidCompositeResult: 'invalid-composite-result';
    readonly invalidDeepAssertionOperand: 'invalid-deep-assertion-operand';
    readonly invalidPlan: 'invalid-plan';
    readonly invalidTimeoutControl: 'invalid-timeout-control';
    readonly invalidRequireReference: 'invalid-require-reference';
    readonly noAssertions: 'no-assertions';
    readonly propertyScope: 'property-scope';
    readonly propertyObservation: 'property-observation';
    readonly pendingInFlightTask: 'pending-in-flight-task';
    readonly pendingAsyncAssertion: 'pending-async-assertion';
    readonly planMismatch: 'plan-mismatch';
    readonly unobservedInFlightTask: 'unobserved-in-flight-task';
};

export type TestContractFailureCode = TestContractFailureCodeByName[keyof TestContractFailureCodeByName];
