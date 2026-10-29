import type { AssertAssertionNode, AssertionResult } from '../assertion-protocol/assertion-node.ts';
import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import type { InFlightTask } from './async-control.ts';
import type { AssertAssertionFacade } from './assertion-facade.ts';
import type { RequireAssertionFacade } from './require-assertion-facade.ts';

export type TestScopeAssertContext = AssertAssertionFacade & {
    readonly collect: () => NonEmptyReadonlyArray<AssertAssertionNode>;
};

export type TestRandom = {
    readonly integer: (minimum: number, maximum: number) => number;
    readonly bytes: (length: number) => Uint8Array;
    readonly pick: <Value>(values: readonly Value[]) => Value;
    readonly uuid: () => string;
    readonly split: () => readonly [TestRandom, TestRandom];
};

export type TestScope = {
    readonly seed: bigint;
    readonly random: TestRandom;
    readonly assert: TestScopeAssertContext;
    readonly cleanup: (callback: () => Promise<void> | void) => void;
    readonly drainMicrotasks: () => Promise<void>;
    readonly plan: (count: number) => void;
    readonly require: RequireAssertionFacade;
    readonly settleAsyncWork: () => Promise<void>;
    readonly signal: AbortSignal;
    readonly startInFlight: <Value>(operation: () => PromiseLike<Value>) => InFlightTask<Value>;
    readonly yieldToNextTurn: () => Promise<void>;
};

export type ThrowingTestScope = {
    readonly seed: bigint;
    readonly random: TestRandom;
    readonly assert: AssertAssertionFacade;
    readonly require: RequireAssertionFacade;
    readonly signal: AbortSignal;
};
export type TestBody = (scope: TestScope) => AssertionResult | Promise<AssertionResult>;
export type ThrowingTestBody = (scope: ThrowingTestScope) => Promise<void> | void;
