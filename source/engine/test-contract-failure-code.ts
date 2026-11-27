type TestContractFailureCodeByName = {
    readonly deadBuilderAssertion: 'dead-builder-assertion';
    readonly invalidAssertionContext: 'invalid-assertion-context';
    readonly invalidAssertionProtocol: 'invalid-assertion-protocol';
    readonly invalidAssertionReference: 'invalid-assertion-reference';
    readonly invalidCompositeResult: 'invalid-composite-result';
    readonly invalidDeepAssertionOperand: 'invalid-deep-assertion-operand';
    readonly lateAssertionActivity: 'late-assertion-activity';
    readonly invalidPlan: 'invalid-plan';
    readonly invalidTimeoutControl: 'invalid-timeout-control';
    readonly invalidRequireReference: 'invalid-require-reference';
    readonly invalidReturnedBuilderAssertion: 'invalid-returned-builder-assertion';
    readonly noAssertions: 'no-assertions';
    readonly propertyScope: 'property-scope';
    readonly propertyObservation: 'property-observation';
    readonly pendingInFlightTask: 'pending-in-flight-task';
    readonly pendingAsyncAssertion: 'pending-async-assertion';
    readonly planMismatch: 'plan-mismatch';
    readonly unobservedInFlightTask: 'unobserved-in-flight-task';
};

export type TestContractFailureCode = TestContractFailureCodeByName[keyof TestContractFailureCodeByName];
