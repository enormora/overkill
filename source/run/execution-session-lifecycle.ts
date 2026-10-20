import { z } from 'zod/v4';
import { withRunnerInfrastructure } from '../engine/execution-observation.ts';
import { withCaseExecutionLifecycle } from '../engine/case-execution-lifecycle.ts';
import type { RunExecutionLifecycle, RunExecutionLifecycleFactory, FileModuleBoundary } from './run-types.ts';
import { withExecutionSession, type RunExecutionTransport } from './execution-session-context.ts';
import { withFileModuleBoundary } from './file-module-boundary.ts';
import { parseRunSelection } from './run-selection-schema.ts';
import type { ExecutionSessionObservation } from './execution-session-runtime-types.ts';

function isLifecycleFactory(value: unknown): value is RunExecutionLifecycleFactory {
    return typeof value === 'function';
}
function isExecutionLifecycle(value: unknown): value is RunExecutionLifecycle {
    return typeof value === 'object' && value !== null &&
        [ 'select', 'beforeCases', 'enterCase', 'completeCase', 'snapshot', 'dispose' ].every(function (method) {
            return typeof Reflect.get(value, method) === 'function';
        });
}
function validatedLifecycle(
    lifecycle: RunExecutionLifecycle,
    observation: ExecutionSessionObservation
): RunExecutionLifecycle {
    return {
        async select(plan) {
            observation.signal.throwIfAborted();
            const selection = parseRunSelection(
                await withRunnerInfrastructure(async function selectLifecyclePlan() {
                    return await lifecycle.select(plan);
                })
            );
            await withRunnerInfrastructure(async function deliverLifecycleCheckpoint() {
                await observation.checkpoint(z.json().parse(lifecycle.snapshot()));
            });
            return selection;
        },
        async beforeCases() {
            observation.signal.throwIfAborted();
            await withRunnerInfrastructure(async function runLifecycleOperation() {
                await lifecycle.beforeCases();
            });
        },
        async enterCase(work) {
            observation.signal.throwIfAborted();
            await withRunnerInfrastructure(async function runLifecycleOperation() {
                await lifecycle.enterCase(work);
            });
        },
        async completeCase(result, errors) {
            const admission = z.enum([ 'continue', 'stop' ]).parse(
                await withRunnerInfrastructure(async function completeLifecycleCase() {
                    return await lifecycle.completeCase(result, errors);
                })
            );
            if (![ 'pass', 'skip' ].includes(result.verdict) || errors.length > 0) {
                await withRunnerInfrastructure(async function deliverLifecycleCheckpoint() {
                    await observation.checkpoint(z.json().parse(lifecycle.snapshot()));
                });
            }
            return observation.signal.aborted ? 'stop' : admission;
        },
        snapshot() {
            return withRunnerInfrastructure(function readLifecycleSnapshot() {
                return z.json().parse(lifecycle.snapshot());
            });
        },
        async dispose() {
            await withRunnerInfrastructure(async function runLifecycleOperation() {
                await lifecycle.dispose();
            });
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
    return created;
}

async function runOwnedLifecycle<Value>(
    lifecycle: RunExecutionLifecycle,
    run: (lifecycle: RunExecutionLifecycle) => Promise<Value>
): Promise<Value> {
    const [ execution ] = await Promise.allSettled([ withCaseExecutionLifecycle({
        async enter(testCase) {
            await lifecycle.enterCase(testCase.workId);
        },
        complete: lifecycle.completeCase
    }, async function () {
        return await run(lifecycle);
    }) ]);
    const [ disposal ] = await Promise.allSettled([ lifecycle.dispose() ]);
    if (execution.status === 'rejected' && disposal.status === 'rejected') {
        throw new AggregateError(
            [ execution.reason, disposal.reason ],
            'Execution and lifecycle disposal failed.',
            { cause: execution.reason }
        );
    }
    if (disposal.status === 'rejected') {
        throw disposal.reason;
    }
    if (execution.status === 'rejected') {
        throw execution.reason;
    }
    return execution.value;
}

export async function withExecutionLifecycle<Value>(
    transport: RunExecutionTransport,
    boundary: FileModuleBoundary | null,
    observation: ExecutionSessionObservation,
    run: (lifecycle: RunExecutionLifecycle) => Promise<Value>
): Promise<Value> {
    return await withExecutionSession(transport, async function () {
        return await withFileModuleBoundary(boundary, async function () {
            const lifecycle = validatedLifecycle(
                await withRunnerInfrastructure(async function bootstrapLifecycle() {
                    return await loadExecutionLifecycle(transport);
                }),
                observation
            );
            return await runOwnedLifecycle(lifecycle, run);
        });
    });
}
