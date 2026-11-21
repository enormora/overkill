import { mkdtempDisposable, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { suite, test } from '@overkill-dev/test';

import { z } from 'zod/v4';
import {
    defineImplementationReference,
    prepareImplementation,
    withPreparedImplementation,
    type ImplementationPreparation
} from '../../packages/engine/engine.entry-point.ts';

type PreloadControl = {
    readonly key: string;
    readonly started: Promise<undefined>;
    readonly finished: Promise<string>;
    readonly resume: () => void;
    readonly close: () => void;
};
function preloadControl(directory: string): PreloadControl {
    const key = `overkill-cancellation:${directory}`;
    const readiness = {
        started: Promise.withResolvers<undefined>(),
        resume: Promise.withResolvers<undefined>(),
        finished: Promise.withResolvers<string>()
    };
    Object.defineProperty(globalThis, Symbol.for(key), {
        configurable: true,
        value: {
            started() {
                readiness.started.resolve(undefined);
            },
            resume: readiness.resume.promise,
            finish: readiness.finished.resolve
        }
    });
    return {
        key,
        started: readiness.started.promise,
        finished: readiness.finished.promise,
        resume() {
            readiness.resume.resolve(undefined);
        },
        close() {
            readiness.resume.resolve(undefined);
            readiness.started.resolve(undefined);
            readiness.finished.resolve('closed');
            Reflect.deleteProperty(globalThis, Symbol.for(key));
        }
    };
}
function moduleSource(key: string): string {
    return [
        `const control=globalThis[Symbol.for(${JSON.stringify(key)})];`,
        'control.started();await control.resume;',
        "try{const name='candidate';await import('./'+name+'.mjs');control.finish('loaded');}",
        'catch(error){control.finish(error.message);}',
        "export const body={version:'1',implementation:42};"
    ]
        .join('\n');
}
function preparationRequest(directory: string, signal: AbortSignal): ImplementationPreparation<null> {
    const entry = pathToFileURL(join(directory, 'body.mjs'));
    const candidate = pathToFileURL(join(directory, 'candidate.mjs'));
    return {
        reference: defineImplementationReference({
            module: { moduleUrl: entry.href, exportName: 'body' },
            realm: 'host',
            version: '1',
            input: null,
            dynamicModules: [ { moduleUrl: candidate.href, exportName: 'value' } ],
            parseInput() {
                return null;
            }
        }),
        context: { projectRoot: directory },
        signal
    };
}
type PendingPreload = { readonly controller: AbortController; readonly admission: Promise<number>; };
async function startPreload(directory: string, key: string): Promise<PendingPreload> {
    await writeFile(join(directory, 'body.mjs'), moduleSource(key));
    await writeFile(join(directory, 'candidate.mjs'), 'export const value=42;');
    const controller = new AbortController();
    const request = preparationRequest(directory, controller.signal);
    const prepared = await prepareImplementation(request);
    return {
        controller,
        admission: withPreparedImplementation(
            { ...request, prepared, parseImplementation: z.number().parse },
            async function use(value) {
                return value;
            }
        )
    };
}

export const testNode = suite('implementation preload cancellation', [
    test(
        'closes pending delivery before delayed evaluation can import changed files',
        async function (scope) {
            await using directory = await mkdtempDisposable(join(tmpdir(), 'overkill-cancel-'));
            const control = preloadControl(directory.path);
            scope.cleanup(async function closeControl() {
                control.close();
            });
            const verifyCancellationDirectory: string = directory.path;
            const verifyCancellationPreload = await startPreload(verifyCancellationDirectory, control.key);
            await control.started;
            verifyCancellationPreload.controller.abort(new Error('Canceled implementation preload.'));
            await scope.assert.rejects(async function canceled() {
                return await verifyCancellationPreload.admission;
            }, { message: 'Canceled implementation preload.' });
            await writeFile(
                join(verifyCancellationDirectory, 'candidate.mjs'),
                "throw new Error('changed module evaluated');"
            );
            control.resume();
            scope.assert.equal(await control.finished, 'Implementation delivery is closed.');
            await scope.yieldToNextTurn();

            return scope.assert.collect();
        }
    )
]);
