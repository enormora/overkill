import { defineBodyReference, type BodyReference } from '../engine/body-reference.ts';
import type { TestScope, AssertionResult, ThrowingTestScope } from '../packages/engine/engine.entry-point.ts';
import { implementationFacts } from '../implementation-reference.ts';
import { caseParticipants } from '../engine/body-reference-participants.ts';
import type { TestPlanCaseExecution } from '../engine/test-plan.ts';
import { readImplementationParticipants, type ImplementationParticipant } from '../implementation-participant.ts';
import { observationCase } from './observation-lifetime.ts';

export type BodyParticipantMode = 'builder' | 'throwing';
type BodyParticipantFixture = {
    readonly participants: readonly ImplementationParticipant[];
    readonly executions: readonly TestPlanCaseExecution[];
    readonly bind: () => Promise<number>;
    readonly rebind: () => Promise<number>;
};
function bodyReference<Scope, Result>(): BodyReference<Scope, Result> {
    return defineBodyReference<null, Scope, Result>({
        module: { moduleUrl: 'file:///project/body.ts', exportName: 'body' },
        realm: 'host',
        version: '1',
        input: null,
        dynamicModules: [],
        parseInput() {
            return null;
        }
    });
}
function referencedExecution(mode: BodyParticipantMode): TestPlanCaseExecution {
    if (mode === 'throwing') {
        return { kind: 'body', bodyMode: 'throwing', body: bodyReference<ThrowingTestScope, undefined>() };
    }
    return { kind: 'body', bodyMode: 'builder', body: bodyReference<TestScope, AssertionResult>() };
}
const initialActivationValue = 42;
const readmittedActivationValue = 43;
export function bodyParticipant(mode: BodyParticipantMode): BodyParticipantFixture {
    const execution = referencedExecution(mode);
    const testCase = { ...observationCase(), execution };
    const executions: TestPlanCaseExecution[] = [];
    const participants = caseParticipants(testCase, function (_key, resolved) {
        executions.push(resolved);
    });
    const namespace = {
        body: {
            version: '1',
            implementation() {
                return undefined;
            }
        }
    };
    const context = { projectRoot: '/project' };
    async function bind(): Promise<number> {
        const participant = participants[0];
        if (participant === undefined) {
            throw new Error('Missing body participant.');
        }
        return await participant.bind(namespace, implementationFacts(participant.reference, context), context).run(
            async function () {
                return initialActivationValue;
            }
        );
    }
    return {
        participants,
        executions,
        bind,
        async rebind() {
            await bind();
            const resolved = executions[0];
            if (resolved?.kind !== 'body') {
                throw new Error('Missing resolved execution.');
            }
            const participant = readImplementationParticipants(resolved.body)[0];
            if (participant === undefined) {
                throw new Error('Missing admitted participant.');
            }
            return await participant.bind(namespace, implementationFacts(participant.reference, context), context).run(
                async function () {
                    return readmittedActivationValue;
                }
            );
        }
    };
}
