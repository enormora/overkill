import assert from 'node:assert/strict';
import { INSTRUMENTER_CONSTANTS, type InstrumenterContext, type MutantCoverage } from '@stryker-mutator/api/core';
import { suite, test } from '../test/test.entry-point.ts';
import type { TestScope } from '../engine/engine.entry-point.ts';
import { createInvocationInstrumentation } from './instrumentation-context.entry-point.ts';
import { createMutationLifecycle } from './mutation-lifecycle.ts';

const namespace = INSTRUMENTER_CONSTANTS.NAMESPACE;
const activeEnvironment = INSTRUMENTER_CONSTANTS.ACTIVE_MUTANT_ENV_VARIABLE;
const environment: Record<string, string | undefined> = Reflect.get(process, 'env');
type CoveredContext = Readonly<InstrumenterContext> & { readonly mutantCoverage: MutantCoverage; };
type CounterReferences = {
    readonly context: CoveredContext;
    readonly coverage: MutantCoverage;
    readonly staticCounters: MutantCoverage['static'];
    readonly perTestCounters: MutantCoverage['perTest'];
};

function restoreContext(previous: Readonly<PropertyDescriptor> | undefined, activeMutant: string | undefined): void {
    if (previous === undefined) {
        Reflect.deleteProperty(globalThis, namespace);
    } else {
        Object.defineProperty(globalThis, namespace, previous);
    }
    if (activeMutant === undefined) {
        Reflect.deleteProperty(environment, activeEnvironment);
    } else {
        environment[activeEnvironment] = activeMutant;
    }
}

function installContext(scope: TestScope, context: unknown): void {
    const previous = Object.getOwnPropertyDescriptor(globalThis, namespace);
    const activeMutant = environment[activeEnvironment];
    Object.defineProperty(globalThis, namespace, { value: context, configurable: true, writable: true });
    environment[activeEnvironment] = 'old-mutant';
    scope.cleanup(function restoreInstrumentation() {
        restoreContext(previous, activeMutant);
    });
}

function staleContext(scope: TestScope): CoveredContext {
    const context = {
        activeMutant: 'old-mutant',
        currentTestId: 'old-case',
        hitCount: 9,
        hitLimit: 1,
        mutantCoverage: { static: { 0: 2 }, perTest: { 'old-case': { 0: 3 } } }
    };
    installContext(scope, context);
    return context;
}

function captureReferences(context: CoveredContext): CounterReferences {
    return {
        context,
        coverage: context.mutantCoverage,
        staticCounters: context.mutantCoverage.static,
        perTestCounters: context.mutantCoverage.perTest
    };
}

function assertRetainedReferences(scope: TestScope, references: CounterReferences): void {
    scope.assert.equal(Reflect.get(globalThis, namespace), references.context);
    scope.assert.equal(references.context.mutantCoverage, references.coverage);
    scope.assert.equal(references.coverage.static, references.staticCounters);
    scope.assert.equal(references.coverage.perTest, references.perTestCounters);
}

function assertBlockedProperties(error: unknown): boolean {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(
        error.errors.map(function message(entry: Error) {
            return entry.message;
        }),
        [
            'Stryker instrumentation cannot reset "currentTestId".',
            'Stryker instrumentation cannot reset "hitLimit".'
        ]
    );
    return true;
}

function blockedHitPolicy(scope: TestScope): CoveredContext {
    const context = new Proxy({ mutantCoverage: { static: {}, perTest: {} } }, {
        set(target, key, value: unknown) {
            if (key === 'hitLimit') {
                throw new Error('Cannot install hit limit.');
            }
            return Reflect.set(target, key, value);
        }
    });
    installContext(scope, context);
    return context;
}

async function activateLifecycle(mode: 'runtime' | 'static'): Promise<void> {
    const lifecycle = await createMutationLifecycle({
        root: process.cwd(),
        mode,
        activeMutant: 'mutant',
        hitLimit: 3,
        baseline: null,
        selected: null,
        disableBail: false,
        files: null
    });
    await lifecycle.beforeCases();
}

export const testNode = suite('invocation instrumentation ownership', [
    test('resets counters without assigning or replacing retained objects', function (scope) {
        const context = staleContext(scope);
        const references = captureReferences(context);
        Object.defineProperty(context, 'mutantCoverage', { writable: false });
        Object.defineProperty(globalThis, namespace, { writable: false });
        const invocation = createInvocationInstrumentation();
        scope.assert.equal(invocation.context, context);
        assertRetainedReferences(scope, references);
        scope.assert.deepEqual(structuredClone(context), { mutantCoverage: { static: {}, perTest: {} } });
        invocation.dispose();
        return scope.assert.collect();
    }),
    test('resets subsequent invocations without replacing retained counters', function (scope) {
        const context = staleContext(scope);
        const references = captureReferences(context);
        const invocation = createInvocationInstrumentation();
        context.mutantCoverage.static['0'] = 4;
        invocation.dispose();
        const next = createInvocationInstrumentation();
        assertRetainedReferences(scope, references);
        scope.assert.deepEqual(context.mutantCoverage, { static: {}, perTest: {} });
        next.dispose();
        return scope.assert.collect();
    }),
    test('disposes transient state repeatedly', function (scope) {
        const context = staleContext(scope);
        const invocation = createInvocationInstrumentation();
        invocation.activate('next', 0);
        invocation.context.currentTestId = 'case';
        environment[activeEnvironment] = 'next';
        invocation.dispose();
        invocation.dispose();
        scope.assert.deepEqual(context, { mutantCoverage: { static: {}, perTest: {} } });
        scope.assert.equal(environment[activeEnvironment], undefined);
        return scope.assert.collect();
    }),
    test('retains collected counters after disposal', function (scope) {
        const context = staleContext(scope);
        const invocation = createInvocationInstrumentation();
        context.mutantCoverage.static['0'] = 4;
        invocation.dispose();
        scope.assert.deepEqual(context.mutantCoverage, { static: { 0: 4 }, perTest: {} });
        return scope.assert.collect();
    }),
    ...[ null, 0, 3 ].map(function hitPolicy(hitLimit) {
        return test(`initializes explicit hit policy ${String(hitLimit)}`, function (scope) {
            installContext(scope, undefined);
            const invocation = createInvocationInstrumentation();
            invocation.activate('mutant', hitLimit);
            scope.assert.deepEqual(structuredClone(invocation.context), {
                mutantCoverage: { static: {}, perTest: {} },
                activeMutant: 'mutant',
                ...hitLimit === null ? {} : { hitCount: 0, hitLimit }
            });
            invocation.dispose();
            const next = createInvocationInstrumentation();
            next.activate('other', null);
            scope.assert.deepEqual(structuredClone(next.context), {
                mutantCoverage: { static: {}, perTest: {} },
                activeMutant: 'other'
            });
            next.dispose();
            return scope.assert.collect();
        });
    }),
    test('continues resetting counters and activation after a counter deletion fails', function (scope) {
        const context = staleContext(scope);
        const staticCounters = context.mutantCoverage.static;
        Object.defineProperty(staticCounters, 'blocked', { value: 7, enumerable: true, configurable: false });
        staticCounters.later = 8;
        scope.assert.throws(createInvocationInstrumentation, {
            message: 'Stryker instrumentation cannot reset "blocked".'
        });
        scope.assert.deepEqual(context, { mutantCoverage: { static: { blocked: 7 }, perTest: {} } });
        scope.assert.equal(environment[activeEnvironment], undefined);
        return scope.assert.collect();
    }),
    test('continues clearing activation after one transient property cannot be deleted', function (scope) {
        const context = staleContext(scope);
        Object.defineProperty(context, 'currentTestId', { configurable: false });
        scope.assert.throws(createInvocationInstrumentation, {
            message: 'Stryker instrumentation cannot reset "currentTestId".'
        });
        scope.assert.deepEqual(context, { currentTestId: 'old-case', mutantCoverage: { static: {}, perTest: {} } });
        scope.assert.equal(environment[activeEnvironment], undefined);
        return scope.assert.collect();
    }),
    test('rolls back a failed partial activation without replacing the namespace', function (scope) {
        const context = staleContext(scope);
        const invocation = createInvocationInstrumentation();
        const failure = new Error('Cannot install hit limit.');
        Object.defineProperty(context, 'hitLimit', {
            configurable: true,
            get() {
                return undefined;
            },
            set() {
                throw failure;
            }
        });
        assert.throws(function activate() {
            invocation.activate('mutant', 3);
        }, failure);
        scope.assert.deepEqual(context, { mutantCoverage: { static: {}, perTest: {} } });
        scope.assert.equal(Reflect.get(globalThis, namespace), context);
        invocation.dispose();
        return scope.assert.collect();
    }),
    test('disposes independent state and reports every blocked property', function (scope) {
        const context = staleContext(scope);
        const invocation = createInvocationInstrumentation();
        invocation.activate('mutant', 3);
        Object.defineProperties(context, {
            currentTestId: { value: 'case', configurable: false, enumerable: true },
            hitLimit: { configurable: false }
        });
        environment[activeEnvironment] = 'mutant';
        assert.throws(invocation.dispose, assertBlockedProperties);
        scope.assert.deepEqual(context, {
            currentTestId: 'case',
            hitLimit: 3,
            mutantCoverage: { static: {}, perTest: {} }
        });
        scope.assert.equal(environment[activeEnvironment], undefined);
        return scope.assert.collect();
    }),
    test('rejects invalid namespaces while cleaning independently removable state', function (scope) {
        const context = { activeMutant: 'old', currentTestId: 'case', mutantCoverage: 'invalid' };
        installContext(scope, context);
        scope.assert.throws(createInvocationInstrumentation, { message: 'Invalid Stryker instrumentation namespace.' });
        scope.assert.deepEqual(context, { mutantCoverage: 'invalid' });
        scope.assert.equal(Reflect.get(globalThis, namespace), context);
        scope.assert.equal(environment[activeEnvironment], undefined);
        return scope.assert.collect();
    }),
    test('cleans activation when a missing coverage object cannot be installed', function (scope) {
        const context = Object.preventExtensions({ activeMutant: 'old' });
        installContext(scope, context);
        scope.assert.throws(createInvocationInstrumentation, {
            message: 'Stryker instrumentation coverage cannot be initialized.'
        });
        scope.assert.deepEqual(context, {});
        scope.assert.equal(environment[activeEnvironment], undefined);
        return scope.assert.collect();
    }),
    test('cleans the environment when a missing namespace cannot be installed', function (scope) {
        installContext(scope, undefined);
        Object.defineProperty(globalThis, namespace, { writable: false });
        scope.assert.throws(createInvocationInstrumentation, {
            message: 'Stryker instrumentation namespace cannot be initialized.'
        });
        scope.assert.equal(Reflect.get(globalThis, namespace), undefined);
        scope.assert.equal(environment[activeEnvironment], undefined);
        return scope.assert.collect();
    }),
    ...([ 'static', 'runtime' ] as const).map(function activationMode(mode) {
        return test(`rolls back failed ${mode} lifecycle activation`, async function (scope) {
            const context = blockedHitPolicy(scope);
            await scope.assert.rejects(async function () {
                await activateLifecycle(mode);
            }, { message: 'Cannot install hit limit.' });
            scope.assert.deepEqual(context, { mutantCoverage: { static: {}, perTest: {} } });
            scope.assert.equal(Reflect.get(globalThis, namespace), context);
            scope.assert.equal(environment[activeEnvironment], undefined);
            return scope.assert.collect();
        });
    })
]);

const { runIfMain } = await import('../../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
