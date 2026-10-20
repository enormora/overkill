import { execFile } from 'node:child_process';
import { extname } from 'node:path';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import type { TestPlanCase } from './test-plan.ts';
import { createExecutionGlobalErrorObserver } from './execution-global-error-observer.ts';
import {
    createExecutionObservation,
    registerExecutionDisposal,
    withExecutionObservation,
    withRunnerInfrastructure
} from './execution-observation.ts';

function guardCase(): TestPlanCase {
    const engine = createTestEngine();
    return engine
        .createTestPlan(engine.createRoot({
            title: 'error ownership',
            annotations: {},
            controls: {},
            children: [ engine.createTestCase({
                title: 'active case',
                annotations: {},
                controls: {},
                definitionLocations: [ { kind: 'unknown' } ],
                body(scope) {
                    scope.assert.true(true);
                    return scope.assert.collect();
                }
            }) ]
        }))
        .cases[0];
}

function rejectInfrastructure(): void {
    process.emit('unhandledRejection', new Error('infrastructure rejection'), Promise.resolve());
}

async function executeOwnershipProbe(script: string, modules: readonly URL[]): Promise<string> {
    return await new Promise<string>(function runProbe(resolve, reject) {
        execFile(process.execPath, [
            '--input-type=module',
            '--eval',
            script,
            ...modules.map(function moduleUrl(module) {
                return module.href;
            })
        ], {
            timeout: 30_000
        }, function receiveProbe(error, stdout, stderr) {
            if (error === null) {
                resolve(stdout);
            } else {
                reject(new Error(stderr, { cause: error }));
            }
        });
    });
}

async function copiedObserverProbe(): Promise<string> {
    const extension = extname(import.meta.url);
    const observer = new URL(`./execution-global-error-observer${extension}`, import.meta.url);
    const ownership = new URL(`./execution-observation${extension}`, import.meta.url);
    const script = `
        const first = await import(process.argv[1]);
        const copiedUrl = new URL(process.argv[1]);
        copiedUrl.search = '?ownership-copy';
        const second = await import(copiedUrl.href);
        const ownership = await import(process.argv[2]);
        const copiedOwnershipUrl = new URL(process.argv[2]);
        copiedOwnershipUrl.search = '?ownership-copy';
        const copiedOwnership = await import(copiedOwnershipUrl.href);
        const observation = ownership.createExecutionObservation();
        const excludesInfrastructure = await observation.run(async () =>
            copiedOwnership.withRunnerInfrastructure(() => !observation.accepts()));
        observation.stop();
        const outer = first.createExecutionGlobalErrorObserver('in-process');
        const inner = second.createExecutionGlobalErrorObserver('in-process');
        let listeners = 0;
        await outer.runBoundary(async () => {
            await inner.runBoundary(async () => {
                listeners = process.listenerCount('unhandledRejection');
                process.emit('unhandledRejection', new Error('copy probe'), Promise.resolve());
            });
            inner.stop();
        });
        const result = {listeners, outerErrors: outer.takeErrors().length, innerErrors: inner.takeErrors().length,
            excludesInfrastructure};
        outer.stop();
        result.remainingListeners = process.listenerCount('unhandledRejection');
        process.stdout.write(JSON.stringify(result));
    `;
    return await executeOwnershipProbe(script, [ observer, ownership ]);
}

async function lateHookProbe(): Promise<string> {
    const extension = extname(import.meta.url);
    const observer = new URL(`./execution-global-error-observer${extension}`, import.meta.url);
    const fixture = new URL(`../test-support/create-test-engine${extension}`, import.meta.url);
    const script = `
        import { AsyncResource } from 'node:async_hooks';
        const {createExecutionGlobalErrorObserver} = await import(process.argv[1]);
        const {createTestEngine} = await import(process.argv[2]);
        const engine = createTestEngine();
        const node = engine.createTestCase({
            title: 'previous case', annotations: {}, controls: {}, definitionLocations: [{kind:'unknown'}],
            body(scope) { scope.assert.true(true); return scope.assert.collect(); }
        });
        const testCase = engine.createTestPlan(engine.createRoot({
            title: 'root', annotations: {}, controls: {}, children: [node]
        })).cases[0];
        const previous = createExecutionGlobalErrorObserver('in-process');
        const late = await previous.runBoundary(async () => previous.runCase(testCase, {index:0}, async () =>
            new AsyncResource('previous invocation')));
        previous.stop();
        const current = createExecutionGlobalErrorObserver('in-process');
        await current.runBoundary(async () => current.runCase(testCase, {index:1}, async () => {
            late.runInAsyncScope(() => {
                process.emit('unhandledRejection', new Error('previous run sentinel'), Promise.resolve());
            });
        }));
        const errors = current.takeErrors();
        const error = errors[0];
        const result = {errorCount:errors.length,subtype:error.subtype,attributedTo:error.attributedTo,
            originAttempt:error.cause.origin.attempt.index,originTitle:error.cause.origin.case.title};
        current.stop();
        late.emitDestroy();
        result.remainingListeners = process.listenerCount('unhandledRejection');
        process.stdout.write(JSON.stringify(result));
    `;
    return await executeOwnershipProbe(script, [ observer, fixture ]);
}

async function rejectedObservationValue(operation: Promise<unknown>): Promise<unknown> {
    try {
        await operation;
        return null;
    } catch (error: unknown) {
        return error;
    }
}

export const testNode = suite('native error ownership', [
    test('retains closed invocation hook origins without blaming a later attempt', async function (scope) {
        scope.assert.equal(
            await lateHookProbe(),
            JSON.stringify({
                errorCount: 1,
                subtype: 'attribution-drift',
                attributedTo: null,
                originAttempt: 0,
                originTitle: 'previous case',
                remainingListeners: 0
            })
        );
        return scope.assert.collect();
    }),
    test('shares process hooks and attribution between module copies', async function (scope) {
        scope.assert.equal(
            await copiedObserverProbe(),
            JSON.stringify({
                listeners: 1,
                outerErrors: 0,
                innerErrors: 1,
                excludesInfrastructure: true,
                remainingListeners: 0
            })
        );
        return scope.assert.collect();
    }),
    test('keeps infrastructure process failures without case attribution', async function (scope) {
        const observer = createExecutionGlobalErrorObserver('in-process');
        scope.cleanup(function stopGlobalObservation() {
            observer.stop();
        });
        await observer.runBoundary(async function observeBoundary() {
            await observer.runCase(guardCase(), { index: 0 }, async function activeAttempt() {
                withRunnerInfrastructure(rejectInfrastructure);
            });
        });
        scope.assert.partialDeepEqual(observer.takeErrors(), [ {
            subtype: 'unhandled-rejection',
            attributedTo: null,
            attributedToWork: null,
            attributedToAttempt: null
        } ]);
        return scope.assert.collect();
    }),
    test('preserves operation and observation shutdown failures', async function (scope: TestScope) {
        const operationError = new Error('operation sentinel');
        const shutdownError = new Error('shutdown sentinel');
        const operation = withExecutionObservation(async function failedOperation() {
            registerExecutionDisposal(function failedShutdown() {
                throw shutdownError;
            });
            throw operationError;
        });
        const error = await rejectedObservationValue(operation);
        scope.require.instanceOf(error, AggregateError);
        scope.assert.equal(error.errors[0], operationError);
        const shutdown: unknown = error.errors[1];
        scope.require.instanceOf(shutdown, AggregateError);
        scope.assert.deepEqual(shutdown.errors, [ shutdownError ]);
        return scope.assert.collect();
    }),
    test('attempts every disposer and immediately disposes registrations after stop', function (scope) {
        const observation = createExecutionObservation();
        const stopped: string[] = [];
        observation.register(function failingDisposal() {
            stopped.push('first');
            throw new Error('disposal sentinel');
        });
        observation.register(function independentDisposal() {
            stopped.push('second');
        });
        scope.assert.throws(observation.stop, { message: 'Execution observation shutdown failed.' });
        observation.register(function lateDisposal() {
            stopped.push('late');
        });
        observation.stop();
        scope.assert.deepEqual(stopped, [ 'first', 'second', 'late' ]);
        return scope.assert.collect();
    })
]);

const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
