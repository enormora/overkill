import { execFile } from 'node:child_process';
import { extname } from 'node:path';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import type { TestPlanCase } from './test-plan.ts';
import { createExecutionGlobalErrorObserver } from './execution-global-error-observer.ts';
import { createExecutionObservation, withRunnerInfrastructure } from './execution-observation.ts';

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

async function copiedObserverProbe(): Promise<string> {
    const extension = extname(import.meta.url);
    const observer = new URL(`./execution-global-error-observer${extension}`, import.meta.url);
    const script = `
        const first = await import(process.argv[1]);
        const copiedUrl = new URL(process.argv[1]);
        copiedUrl.search = '?ownership-copy';
        const second = await import(copiedUrl.href);
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
        const result = {listeners, outerErrors: outer.takeErrors().length, innerErrors: inner.takeErrors().length};
        outer.stop();
        result.remainingListeners = process.listenerCount('unhandledRejection');
        process.stdout.write(JSON.stringify(result));
    `;
    return await new Promise<string>(function runProbe(resolve, reject) {
        execFile(process.execPath, [ '--input-type=module', '--eval', script, observer.href ], {
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

export const testNode = suite('native error ownership', [
    test('shares process hooks and attribution between module copies', async function (scope) {
        scope.assert.equal(
            await copiedObserverProbe(),
            JSON.stringify({
                listeners: 1,
                outerErrors: 0,
                innerErrors: 1,
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
    test('attempts every observation disposer and stops only once', function (scope) {
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
        observation.stop();
        scope.assert.deepEqual(stopped, [ 'first', 'second' ]);
        return scope.assert.collect();
    })
]);

const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
