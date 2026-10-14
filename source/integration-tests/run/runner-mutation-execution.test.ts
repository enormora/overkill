import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { createSuite, createTestCase, type TestScope } from '../../packages/engine/engine.entry-point.ts';
import { createLineReporter } from '../../packages/reporter-line/reporter-line.entry-point.ts';
import { normalizeConfig, orchestrator } from '../../packages/run/run.entry-point.ts';
import { createMutationRunCommand } from '../../packages/stryker-runner/mutation-execution-policy.ts';
import { runIfMain } from '../direct-launcher.test.ts';
import { createMutationExecution, type MutationExecution } from './mutation-execution.test.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
const engineModule = new URL(`../../packages/engine/engine.entry-point${extname(import.meta.url)}`, import.meta.url);
const engineUrl = engineModule.href;
const all = { kind: 'all' } as const;
const processModels = [ 'in-process', 'supervised-process' ] as const;
const executionModes = processModels.flatMap(function processModes(processModel) {
    return [ false, true ].map(function stateModes(freshState) {
        return { processModel, freshState };
    });
});
type ProcessModel = typeof processModels[number];
type ExecutionProject = { readonly cwd: string; readonly execution: MutationExecution; };

async function createExecutionProject(
    scope: TestScope,
    processModel: ProcessModel,
    freshState: boolean,
    source: string
): Promise<ExecutionProject> {
    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'overkill-mutation-execution-')));
    scope.cleanup(async function removeProject() {
        await rm(cwd, { recursive: true, force: true });
    });
    await writeFile(join(cwd, 'case.test.mjs'), source);
    await writeFile(
        join(cwd, 'state.mjs'),
        `
let active = 0;
let executions = 0;
export function enter() { return ++active; }
export function leave() { active--; }
export function nextExecution() { return ++executions; }
`
    );
    await writeFile(join(cwd, 'mutable.cjs'), 'exports.next = () => ++exports.count; exports.count = 0;');
    await writeFile(join(cwd, 'nested.mjs'), "import state from './mutable.cjs'; export const next = state.next;");
    const policy = await orchestrator.freezePolicy({
        moduleBoundary: null,
        source: { kind: 'memory' },
        command: createMutationRunCommand({
            cwd,
            profile: 'microtest',
            config: normalizeConfig({
                profiles: {
                    microtest: {
                        testFamily: 'microtest',
                        files: { include: [ 'case.test.mjs' ] },
                        execution: { processModel, scheduling: 'concurrent' },
                        timeouts: { collectionMilliseconds: 30_000 }
                    }
                }
            })
        })
    });
    const execution = createMutationExecution({ policy, seed: { value: 42n }, freshState });
    scope.cleanup(async function disposeExecution() {
        await execution.dispose();
    });
    return { cwd, execution };
}

function serialCases(processModel: ProcessModel, freshState: boolean): string {
    return `
import { createSuite, createTestCase } from ${JSON.stringify(engineUrl)};
import { enter, leave, nextExecution } from './state.mjs';
import { next } from './nested.mjs';
globalThis.mutationExecutions = 0;
const metadata = { annotations: {}, controls: {}, definitionLocations: [{kind:'unknown'}] };
export const testNode = createSuite({ ...metadata, title: 'serial cases', children:
    [0, 1, 2].map(index => createTestCase({ ...metadata, title: 'case ' + index,
        async body(scope) {
            scope.cleanup(leave);
            scope.assert.equal(enter(), 1);
            scope.assert.equal(process.pid === ${process.pid}, ${processModel === 'in-process' && !freshState});
            scope.assert.equal(process.execArgv.includes('--permission'), ${processModel === 'supervised-process'});
            scope.assert.equal(process.ppid === ${process.pid}, ${processModel !== 'in-process' || freshState});
            if (index === 0) {
                scope.assert.equal(nextExecution(), 1);
                scope.assert.equal(next(), 1);
                scope.assert.equal(++globalThis.mutationExecutions, 1);
            }
            await Promise.resolve();
            return scope.assert.collect();
        }
    }))
});
`;
}

export const testNode = createSuite({
    ...metadata,
    title: 'configured mutation process models',
    children: [
        ...executionModes.map(function processModelTest({ processModel, freshState }) {
            return createTestCase({
                ...metadata,
                title: `${processModel} with freshState ${freshState} preserves isolation, serial cases, and selection`,
                async body(scope: TestScope) {
                    const { execution } = await createExecutionProject(
                        scope,
                        processModel,
                        freshState,
                        serialCases(processModel, freshState)
                    );
                    const first = await execution.run(all);
                    const selected = first.perTest.find(function secondCase(result) {
                        return result.id.title === 'case 1';
                    });
                    scope.require.defined(selected);
                    const narrowed = await execution.run({
                        kind: 'filter',
                        filter: { kind: 'case-id', id: selected.id }
                    });
                    const repeated = await execution.run(all);
                    scope.assert.deepEqual({
                        statuses: [ first.status, narrowed.status, repeated.status ],
                        executed: [ first.perTest.length, narrowed.perTest.length, repeated.perTest.length ],
                        errors: [ first.runnerErrors, narrowed.runnerErrors, repeated.runnerErrors ],
                        repeatedFailures: repeated.summary.failed
                    }, {
                        statuses: [
                            'passed',
                            'passed',
                            processModel === 'in-process' && !freshState ? 'failed' : 'passed'
                        ],
                        executed: [ 3, 1, 3 ],
                        errors: [ [], [], [] ],
                        repeatedFailures: processModel === 'in-process' && !freshState ? 1 : 0
                    }, { message: JSON.stringify({ first, repeated }) });
                    return scope.assert.collect();
                }
            });
        }),
        createTestCase({
            ...metadata,
            title: 'construction defers imports and a failed collection remains cached',
            async body(scope) {
                const { cwd, execution } = await createExecutionProject(
                    scope,
                    'in-process',
                    false,
                    'throw new Error("collection sentinel");'
                );
                await scope.assert.rejects(async function rejectFirstCollection() {
                    return await execution.run(all);
                }, { cause: { message: 'collection sentinel' } });
                await writeFile(join(cwd, 'case.test.mjs'), serialCases('in-process', false));
                await scope.assert.rejects(async function retainCollectionFailure() {
                    return await execution.run(all);
                }, { cause: { message: 'collection sentinel' } });
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'invocation admission closes synchronously on disposal',
            async body(scope) {
                const { execution } = await createExecutionProject(
                    scope,
                    'in-process',
                    false,
                    serialCases('in-process', false)
                );
                const running = execution.run(all);
                await scope.assert.rejects(async function rejectConcurrentInvocation() {
                    return await execution.run(all);
                }, { message: /already running/u });
                const disposal = execution.dispose();
                await scope.assert.rejects(async function rejectDisposedInvocation() {
                    return await execution.run(all);
                }, { message: /disposed/u });
                const result = await running;
                scope.assert.equal(result.status, 'passed');
                await disposal;
                await execution.dispose();
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'fresh collection failures do not poison subsequent invocations',
            async body(scope) {
                const { cwd, execution } = await createExecutionProject(
                    scope,
                    'in-process',
                    true,
                    'throw new Error("fresh collection sentinel");'
                );
                await scope.assert.rejects(async function failCollection() {
                    return await execution.run(all);
                }, { cause: { message: 'fresh collection sentinel' } });
                await writeFile(join(cwd, 'case.test.mjs'), serialCases('in-process', true));
                const first = await execution.run(all);
                const second = await execution.run(all);
                scope.assert.deepEqual([ first.status, second.status ], [ 'passed', 'passed' ]);
                return scope.assert.collect();
            }
        }),
        ...[ false, true ].map(function cachedSourceTest(freshState) {
            return createTestCase({
                ...metadata,
                title: `freshState ${freshState} exposes the documented cache effect on changed source`,
                async body(scope) {
                    const source = `
import { createTestCase } from ${JSON.stringify(engineUrl)};
import { value } from './subject.mjs';
const cached = value;
export const testNode = createTestCase({
    annotations: {}, controls: {}, definitionLocations: [{kind:'unknown'}], title: 'cached production value',
    body(scope) { scope.assert.equal(cached, 2); return scope.assert.collect(); }
});
`;
                    const { cwd, execution } = await createExecutionProject(scope, 'in-process', freshState, source);
                    await writeFile(join(cwd, 'subject.mjs'), 'export const value = 2;');
                    const first = await execution.run(all);
                    await writeFile(join(cwd, 'subject.mjs'), 'export const value = 3;');
                    const mutated = await execution.run(all);
                    scope.assert.deepEqual({
                        statuses: [ first.status, mutated.status ],
                        failures: mutated.summary.failed,
                        errors: mutated.runnerErrors
                    }, {
                        statuses: [ 'passed', freshState ? 'failed' : 'passed' ],
                        failures: freshState ? 1 : 0,
                        errors: []
                    });
                    return scope.assert.collect();
                }
            });
        }),
        createTestCase({
            ...metadata,
            title: 'fresh hosts reject native exit without a result',
            async body(scope) {
                const { execution } = await createExecutionProject(scope, 'in-process', true, 'process.exit(0);');
                await scope.assert.rejects(async function exitBeforeResult() {
                    return await execution.run(all);
                }, { message: /without a result/u });
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'fresh disposal interrupts collection and reaps the invocation host',
            async body(scope) {
                const { execution } = await createExecutionProject(
                    scope,
                    'in-process',
                    true,
                    'await new Promise(() => {});'
                );
                const running = execution.run(all);
                const rejection = scope.assert.rejects(async function interruptCollection() {
                    return await running;
                }, { message: /aborted/u });
                await execution.dispose();
                await rejection;
                await execution.dispose();
                await scope.assert.rejects(async function rejectDisposedInvocation() {
                    return await execution.run(all);
                }, { message: /disposed/u });
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'supervised disposal interrupts collection and awaits the owned child',
            async body(scope) {
                const { execution } = await createExecutionProject(
                    scope,
                    'supervised-process',
                    false,
                    'await new Promise(() => {});'
                );
                const running = execution.run(all);
                const rejection = scope.assert.rejects(async function interruptCollection() {
                    return await running;
                }, { message: /aborted/u });
                await execution.dispose();
                await rejection;
                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testNode, [ createLineReporter() ]);
