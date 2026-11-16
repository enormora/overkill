import {
    attachImplementationParticipants,
    readImplementationParticipants,
    type ImplementationParticipant
} from '../implementation-participant.ts';
import type { ImplementationInputContext, ImplementationFacts } from '../implementation-reference.ts';
import { isBodyReference } from './test-body.ts';
import type { BodyReference } from './body-reference.ts';
import type { TestPlanCase, TestPlanCaseExecution } from './test-plan.ts';
import { workIdentityKey } from './identity.ts';

export type RecordExecution = (key: string, execution: TestPlanCaseExecution) => void;
type BodyAdmission = {
    readonly namespace: unknown;
    readonly facts: ImplementationFacts;
    readonly context: ImplementationInputContext;
};

function admittedBody<Scope, Result>(
    reference: BodyReference<Scope, Result>,
    admission: BodyAdmission
): (scope: Scope) => Result {
    const body = reference.bind(admission.namespace, admission.facts, admission.context);
    return attachImplementationParticipants(body, [ {
        key: 'body',
        role: 'body',
        scope: null,
        binding: null,
        reference: reference.reference,
        bind(namespace, facts, context) {
            reference.bind(namespace, facts, context);
            return {
                async run(operation) {
                    return await operation();
                }
            };
        }
    } ]);
}
function bindThrowingExecution(
    execution: Extract<TestPlanCaseExecution, { readonly bodyMode: 'throwing'; }>,
    admission: BodyAdmission
): TestPlanCaseExecution {
    return isBodyReference(execution.body)
        ? { ...execution, body: admittedBody(execution.body, admission) }
        : execution;
}
function resolvedExecution(execution: TestPlanCaseExecution, admission: BodyAdmission): TestPlanCaseExecution {
    if (execution.kind === 'skip') {
        return execution;
    }
    if (execution.bodyMode === 'throwing') {
        return bindThrowingExecution(execution, admission);
    }
    if (execution.bodyMode === 'benchmark') {
        return isBodyReference(execution.body)
            ? { ...execution, body: admittedBody(execution.body, admission) }
            : execution;
    }
    return isBodyReference(execution.body)
        ? { ...execution, body: admittedBody(execution.body, admission) }
        : execution;
}

export function caseParticipants(
    testCase: TestPlanCase,
    record: RecordExecution
): readonly ImplementationParticipant[] {
    const key = workIdentityKey(testCase.workId);
    const { execution } = testCase;
    if (execution.kind === 'skip') {
        return [];
    }
    const participants = readImplementationParticipants(
        execution.bodyMode === 'benchmark' ? execution.resourceBody : execution.body
    )
        .map(function owned(participant) {
            return { ...participant, key: `${key}:${participant.key}` };
        });
    if (isBodyReference(execution.body)) {
        participants.push({
            role: 'body',
            scope: null,
            binding: null,
            key: `${key}:body`,
            reference: execution.body.reference,
            bind(namespace, facts, context) {
                record(key, resolvedExecution(execution, { namespace, facts, context }));
                return {
                    async run(operation) {
                        return await operation();
                    }
                };
            }
        });
    }
    return participants;
}
