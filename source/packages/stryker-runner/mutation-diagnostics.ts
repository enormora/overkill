import { workIdentityKey, type PerTestResult, type RunnerError } from '../run/run.entry-point.ts';
import { classifyMutationCase, type MutationCaseClassification } from './mutation-case-classification.ts';
import { canonicalWork, type mutationLifecycleDataSchema } from './mutation-catalog.ts';

type MutationCaseObservation = {
    readonly id: string;
    readonly classification: MutationCaseClassification;
};
type LifecycleData = ReturnType<typeof mutationLifecycleDataSchema.parse>;
type MutationDiagnosticRecorder = {
    readonly record: (
        result: PerTestResult,
        errors: readonly RunnerError[],
        hitLimitExceeded: boolean
    ) => MutationCaseClassification;
    readonly snapshot: () => Pick<LifecycleData, 'caseFailures' | 'infrastructureErrors'>;
};

export function mutationDiagnostics(
    observations: readonly MutationCaseObservation[],
    errors: readonly RunnerError[]
): Pick<LifecycleData, 'caseFailures' | 'infrastructureErrors'> {
    const attributed = new Set(observations.flatMap(function attributedErrors({ classification }) {
        return classification.kind === 'killed' || classification.kind === 'timeout' ? classification.runnerErrors : [];
    }));
    return {
        caseFailures: observations.flatMap(function failedCase({ id, classification }) {
            if (classification.kind === 'pass' || classification.kind === 'skip') {
                return [];
            }
            return [ { id, kind: classification.kind, message: classification.message } ];
        }),
        infrastructureErrors: errors
            .filter(function unclaimedError(error) {
                return !attributed.has(error);
            })
            .map(function errorMessage(error) {
                return error.message;
            })
    };
}

export function hasMutationExecutionError(
    diagnostics: Readonly<Pick<LifecycleData, 'caseFailures' | 'infrastructureErrors'>>
): boolean {
    return diagnostics.infrastructureErrors.length > 0 || diagnostics.caseFailures.some(function invalidCase(failure) {
        return failure.kind === 'error';
    });
}

export function createMutationDiagnostics(root: string): MutationDiagnosticRecorder {
    const observations: MutationCaseObservation[] = [];
    const observedErrors = new Set<RunnerError>();
    return {
        record(result, errors, hitLimitExceeded) {
            const classification = classifyMutationCase(root, result, errors, hitLimitExceeded);
            observations.push({ id: workIdentityKey(canonicalWork(root, result.workId)), classification });
            for (const error of errors) {
                observedErrors.add(error);
            }
            return classification;
        },
        snapshot() {
            return mutationDiagnostics(observations, Array.from(observedErrors));
        }
    };
}
