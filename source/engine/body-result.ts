import type { AssertionNode } from '../assertion-protocol/assertion-node.ts';
import type { ThrownErrorRecord } from '../assertion-protocol/thrown-error-record.ts';
import type { RunnerError, TestContractFailure } from './run-result.ts';

export type ExecutedBody = {
    readonly bodyError: ThrownErrorRecord | null;
    readonly cleanupErrors: readonly ThrownErrorRecord[];
    readonly contractFailures: readonly TestContractFailure[];
    readonly inconclusiveReason: string | null;
    readonly requireFailed: boolean;
    readonly runnerErrors: readonly RunnerError[];
    readonly returnedAssertions: readonly AssertionNode[];
};
