import { z } from 'zod/v4';
import { withCaseExecutionLifecycle } from '../engine/case-execution-lifecycle.ts';
import type { RunExecutionLifecycle, RunExecutionLifecycleFactory, FileModuleBoundary } from './run-types.ts';
import { withExecutionSession, type RunExecutionTransport } from './execution-session-context.ts';
import { withFileModuleBoundary } from './file-module-boundary.ts';
import { parseRunSelection } from './run-selection-schema.ts';

function isLifecycleFactory(value: unknown): value is RunExecutionLifecycleFactory {
    return typeof value === 'function';
}
function isExecutionLifecycle(value: unknown): value is RunExecutionLifecycle {
    return typeof value === 'object' && value !== null &&
        [ 'select', 'beforeCases', 'enterCase', 'completeCase', 'snapshot', 'dispose' ].every(function (method) {
            return typeof Reflect.get(value, method) === 'function';
        });
}
function validatedLifecycle(lifecycle: RunExecutionLifecycle): RunExecutionLifecycle {
    return {
        async select(plan) {
            return parseRunSelection(await lifecycle.select(plan));
        },
        async beforeCases() {
            await lifecycle.beforeCases();
        },
        async enterCase(work) {
            await lifecycle.enterCase(work);
        },
        async completeCase(result, errors) {
            return z.enum([ 'continue', 'stop' ]).parse(await lifecycle.completeCase(result, errors));
        },
        snapshot() {
            return z.json().parse(lifecycle.snapshot());
        },
        async dispose() {
            await lifecycle.dispose();
        }
    };
}

async function loadExecutionLifecycle(transport: RunExecutionTransport): Promise<RunExecutionLifecycle> {
    const module: unknown = await import(transport.lifecycle.moduleUrl);
    const factory: unknown = typeof module === 'object' && module !== null
        ? Reflect.get(module, transport.lifecycle.exportName)
        : null;
    if (!isLifecycleFactory(factory)) {
        throw new TypeError('Execution lifecycle export must be a factory.');
    }
    const created: unknown = await factory(structuredClone(transport.data));
    if (!isExecutionLifecycle(created)) {
        throw new TypeError('Execution lifecycle factory returned an invalid lifecycle.');
    }
    return validatedLifecycle(created);
}

export async function withExecutionLifecycle<Value>(
    transport: RunExecutionTransport,
    boundary: FileModuleBoundary | null,
    run: (lifecycle: RunExecutionLifecycle) => Promise<Value>
): Promise<Value> {
    return await withExecutionSession(transport, async function () {
        return await withFileModuleBoundary(boundary, async function () {
            const lifecycle = await loadExecutionLifecycle(transport);
            try {
                return await withCaseExecutionLifecycle({
                    async enter(testCase) {
                        await lifecycle.enterCase(testCase.workId);
                    },
                    complete: lifecycle.completeCase
                }, async function () {
                    return await run(lifecycle);
                });
            } finally {
                await lifecycle.dispose();
            }
        });
    });
}
