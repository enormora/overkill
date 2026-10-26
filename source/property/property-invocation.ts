import {
    readPropertyExecutionHost,
    stopPropertyExecution,
    propertyScopeContractFailure,
    captureSourceLocation,
    resolveSourceLocation,
    relativizeSourceLocationPath,
    type AssertionResult,
    type AssertAssertionNode,
    type DefinitionLocations,
    type TestScope
} from '../packages/engine/engine.entry-point.ts';
import { executeProperty, type PropertyExecutionResult } from './property-execution.ts';
import type {
    NormalizedPropertyInvocation,
    PropertyForall,
    PropertyInvocation,
    PropertyBody
} from './property-definition.ts';
import { ensureGenerator, type Generator as PropertyGenerator } from './generator.ts';

function propertyExamples<Value>(invocation: PropertyInvocation<Value>): readonly (() => Value)[] {
    function hasExamples(value: PropertyInvocation<Value>): value is NormalizedPropertyInvocation<Value> {
        return Object.hasOwn(value, 'examples');
    }
    return hasExamples(invocation) ? invocation.examples : [];
}

export function normalizePropertyInvocation<Value>(
    invocation: PropertyInvocation<Value>
): NormalizedPropertyInvocation<Value> {
    ensureGenerator(invocation.generator);
    if (typeof invocation.test !== 'function') {
        throw new TypeError('Property invocation requires a test body.');
    }
    const examples = propertyExamples(invocation);
    if (
        !Array.isArray(examples) || examples.some(function invalidExample(example) {
            return typeof example !== 'function';
        })
    ) {
        throw new TypeError('Property examples must be synchronous fresh-input factories.');
    }
    return Object.freeze({ ...invocation, examples: Object.freeze(Array.from(examples)) });
}

type InvocationContext = {
    readonly scope: TestScope;
    readonly signal: AbortSignal;
    readonly identity: string;
    readonly locations: DefinitionLocations;
};

function propertyBoundaryResult<Value>(
    result: PropertyExecutionResult<Value>,
    locations: DefinitionLocations
): AssertAssertionNode {
    if (result.kind === 'failed') {
        if (result.trial.kind === 'terminated') {
            stopPropertyExecution(result.trial.result);
        }
        return result.trial.assertion;
    }
    if (result.kind !== 'completed') {
        stopPropertyExecution({
            bodyError: null,
            cleanupErrors: [],
            contractFailures: [],
            inconclusiveReason: result.kind === 'work-exhausted'
                ? 'Property total work budget exhausted before required checks completed.'
                : 'Property generation exhausted before required exploration completed.',
            requireFailed: false,
            runnerErrors: [],
            returnedAssertions: []
        });
    }
    return {
        check: 'true',
        actual: true,
        message: 'Property completed its required checks.',
        source: 'assert',
        sourceLocations: locations
    };
}

export async function runPropertyInvocation<Value>(
    invocation: NormalizedPropertyInvocation<Value>,
    context: InvocationContext
): Promise<AssertionResult> {
    const { scope, signal, identity, locations } = context;
    const host = readPropertyExecutionHost(scope);
    return await host.recordBoundary(async function evaluateInvocation() {
        const result = await executeProperty(invocation, { checkedIn: [], localCache: [] }, { host, signal, identity });
        return propertyBoundaryResult(result, locations);
    }, signal);
}

export type NestedPropertySession = {
    readonly forall: PropertyForall;
    readonly finish: () => Promise<void>;
};

type InvocationScope = {
    readonly run: (operation: (signal: AbortSignal) => Promise<AssertionResult>) => Promise<AssertionResult>;
    readonly finish: () => Promise<void>;
};

async function settleInvocation(pending: Promise<AssertionResult>, complete: () => void): Promise<void> {
    try {
        await pending;
    } catch {
    } finally {
        complete();
    }
}

function createInvocationScope(scope: TestScope): InvocationScope {
    let closed = false;
    let active: { readonly controller: AbortController; readonly settled: Promise<void>; } | null = null;
    return {
        async run(operation) {
            if (closed || scope.signal.aborted) {
                propertyScopeContractFailure('Property invocation cannot start after its scope has closed.');
            }
            if (active !== null) {
                active.controller.abort();
                propertyScopeContractFailure('Nested property invocations must be awaited sequentially.');
            }
            const controller = new AbortController();
            const pending = operation(AbortSignal.any([ scope.signal, controller.signal ]));
            const settled = settleInvocation(pending, function releaseInvocation() {
                active = null;
            });
            active = { controller, settled };
            return pending;
        },
        async finish() {
            closed = true;
            const pending = active;
            if (pending !== null) {
                pending.controller.abort();
                await pending.settled;
                if (!scope.signal.aborted) {
                    propertyScopeContractFailure('Property scope completed with an unfinished invocation.');
                }
            }
        }
    };
}

function normalizeForall<Value>(
    definition: PropertyGenerator<Value> | PropertyInvocation<Value>,
    body: readonly [] | readonly [PropertyBody<Value>]
): NormalizedPropertyInvocation<Value> {
    function isInvocation(
        value: PropertyGenerator<Value> | PropertyInvocation<Value>
    ): value is PropertyInvocation<Value> {
        return Object.hasOwn(value, 'generator');
    }
    if (isInvocation(definition)) {
        return normalizePropertyInvocation(definition);
    }
    if (body.length === 0) {
        throw new TypeError('Property invocation requires a test body.');
    }
    return normalizePropertyInvocation({ generator: definition, test: body[0] });
}

function invocationLocationKey(location: DefinitionLocations[number], scope: TestScope): string {
    const resolved = resolveSourceLocation(location);
    const { projectRoot } = readPropertyExecutionHost(scope);
    return JSON.stringify(
        resolved.kind === 'known'
            ? { ...resolved, file: relativizeSourceLocationPath(resolved, projectRoot) }
            : resolved
    );
}

export function createNestedPropertySession(scope: TestScope): NestedPropertySession {
    const session = createInvocationScope(scope);
    const occurrences = new Map<string, number>();
    function forall<Value>(generator: PropertyGenerator<Value>, body: PropertyBody<Value>): Promise<AssertionResult>;
    function forall<Value>(invocation: PropertyInvocation<Value>): Promise<AssertionResult>;
    async function forall<Value>(
        definition: PropertyGenerator<Value> | PropertyInvocation<Value>,
        ...body: readonly [] | readonly [PropertyBody<Value>]
    ): Promise<AssertionResult> {
        const location = captureSourceLocation();
        const key = invocationLocationKey(location, scope);
        const occurrence = occurrences.get(key) ?? 0;
        occurrences.set(key, occurrence + 1);
        const invocation = normalizeForall(definition, body);
        return session.run(async function executeNestedInvocation(signal) {
            return await runPropertyInvocation(invocation, {
                scope,
                signal,
                identity: JSON.stringify([ key, occurrence ]),
                locations: [ location ]
            });
        });
    }
    return { forall, finish: session.finish };
}
