import { setTimeout as waitForPhase } from 'node:timers/promises';
import type { JsonValue } from 'type-fest';
import { z } from 'zod/v4';
import { createSuite, createTestCase } from '../../../packages/engine/engine.entry-point.ts';
import type { RunExecutionLifecycle, RunSelection } from '../../../packages/run/run.entry-point.ts';

const modeSchema = z.enum([
    'pass',
    'narrow',
    'stop',
    'select',
    'before',
    'enter',
    'complete',
    'snapshot',
    'dispose',
    'before-and-dispose',
    'late-result',
    'late-failure',
    'duplicate-data',
    'malformed-data',
    'invalid-host-reply',
    'exit-before-data'
]);
async function sendFrame(message: Readonly<Record<string, unknown>>): Promise<void> {
    const send = process.send?.bind(process);
    if (send === undefined) {
        throw new Error('Lifecycle fixture requires IPC.');
    }
    await new Promise<void>(function (resolve, reject) {
        send(message, function (error) {
            if (error === null) {
                resolve();
            } else {
                reject(error);
            }
        });
    });
}
async function corruptSessionData(mode: z.infer<typeof modeSchema>): Promise<void> {
    const frame = {
        correlationId: 'supervised-run', kind: 'overkill-child-message',
        message: { kind: 'execution-data', data: 'first' }
    };
    if (mode === 'duplicate-data') {
        await sendFrame(frame);
        await sendFrame(frame);
    }
    if (mode === 'malformed-data') {
        await sendFrame({ ...frame, message: { kind: 'execution-data' } });
    }
    if (mode === 'invalid-host-reply') {
        await sendFrame({ kind: 'unexpected' });
    }
}
export const notALifecycleFactory = null;
export async function emptyLifecycleFactory(): Promise<null> {
    return null;
}
export async function incompleteLifecycleFactory(): Promise<{ readonly select: null; }> {
    return { select: null };
}
export async function createSessionLifecycle(data: JsonValue): Promise<RunExecutionLifecycle> {
    const mode = modeSchema.parse(data);
    if (mode === 'exit-before-data') {
        if (process.send === undefined) {
            throw new Error('Lifecycle fixture requires IPC.');
        }
        process.exit(9);
    }
    const events: string[] = [];
    function visit(phase: string): void {
        events.push(phase);
        if (mode === phase || mode === 'before-and-dispose' && [ 'before', 'dispose' ].includes(phase)) {
            throw new Error(`Lifecycle ${phase} failed.`);
        }
    }
    return {
        async select(): Promise<RunSelection> {
            visit('select');
            if (mode === 'narrow') {
                return { kind: 'filter', filter: { kind: 'equals', field: 'title', value: 'passes' } };
            }
            return { kind: 'all' };
        },
        async beforeCases(): Promise<void> {
            visit('before');
            await corruptSessionData(mode);
            if (mode.startsWith('late-')) {
                await waitForPhase(20);
            }
            if (mode === 'late-failure') {
                throw new Error('Lifecycle failed after the deadline.');
            }
        },
        async enterCase(): Promise<void> {
            visit('enter');
        },
        async completeCase(): Promise<'continue' | 'stop'> {
            visit('complete');
            return mode === 'stop' ? 'stop' : 'continue';
        },
        snapshot(): JsonValue {
            visit('snapshot');
            return Array.from(events);
        },
        async dispose(): Promise<void> {
            visit('dispose');
        }
    };
}

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
export const testNode = createSuite({
    ...metadata,
    title: 'session lifecycle cases',
    children: [ 'first', 'second' ].map(function lifecycleCase(title) {
        return createTestCase({
            ...metadata,
            title,
            body(scope) {
                scope.assert.equal(scope.signal.aborted, false);
                return scope.assert.collect();
            }
        });
    })
});
