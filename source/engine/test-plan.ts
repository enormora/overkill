export type TestPlanCaseBody = () => Promise<void> | void;

export type TestPlanCase = {
    readonly body: TestPlanCaseBody;
    readonly id: string;
    readonly metadata: Readonly<Record<string, unknown>>;
    readonly suitePath: readonly string[];
};

export type TestPlan = {
    readonly cases: readonly TestPlanCase[];
};
