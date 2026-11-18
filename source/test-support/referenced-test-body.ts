import { defineBodyReference, type BodyReference } from '../engine/body-reference.ts';
import {
    implementationFacts,
    type ImplementationFacts,
    type ImplementationInputContext
} from '../implementation-reference.ts';
import type { TestScope, AssertionResult } from '../packages/engine/engine.entry-point.ts';

type ReferencedTestBodyFixture = {
    readonly body: BodyReference<TestScope, AssertionResult>;
    readonly context: ImplementationInputContext;
    readonly facts: ImplementationFacts;
};
export function referencedTestBody(): ReferencedTestBodyFixture {
    const context = { projectRoot: '/project' };
    const body = defineBodyReference<null, TestScope, AssertionResult>({
        module: { moduleUrl: 'file:///project/body.ts', exportName: 'body' },
        realm: 'host',
        version: '1',
        input: null,
        dynamicModules: [],
        parseInput() {
            return null;
        }
    });
    const facts = implementationFacts(body.reference, context);
    return { body, context, facts };
}
