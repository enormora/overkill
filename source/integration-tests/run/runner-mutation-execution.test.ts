import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { createSuite, createTestCase, type TestScope } from '../../packages/engine/engine.entry-point.ts';
import { createLineReporter } from '../../packages/reporter-line/reporter-line.entry-point.ts';
import { normalizeConfig, orchestrator } from '../../packages/run/run.entry-point.ts';
import { createMutationRunCommand } from '../../packages/stryker-runner/mutation-execution-policy.ts';
import { createMutationExecution, type MutationExecution } from '../../packages/stryker-runner/mutation-execution.ts';
import { runIfMain } from '../direct-launcher.test.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
const engineModule = new URL(`../../packages/engine/engine.entry-point${extname(import.meta.url)}`, import.meta.url);
const engineUrl = engineModule.href;
const all = { kind: 'all' } as const;
const processModels = [ 'in-process', 'supervised-process' ] as const;
type ProcessModel = typeof processModels[number];
type ExecutionProject = { readonly cwd: string; readonly execution: MutationExecution; };

async function createExecutionProject(
    scope: TestScope,
    processModel: ProcessModel,
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
                        timeouts: { collectionMilliseconds: 10_000 }
                    }
                }
            })
        })
    });
    const execution = createMutationExecution({ policy, seed: { value: 42n } });
    scope.cleanup(async function disposeExecution() {
        await execution.dispose();
    });
    return { cwd, execution };
}

function serialCases(processModel: ProcessModel): string {
    return `
import { createSuite, createTestCase } from ${JSON.stringify(engineUrl)};
import { enter, leave, nextExecution } from './state.mjs';
const metadata = { annotations: {}, controls: {}, definitionLocations: [{kind:'unknown'}] };
export const testNode = createSuite({ ...metadata, title: 'serial cases', children:
    [0, 1, 2].map(index => createTestCase({ ...metadata, title: 'case ' + index,
        async body(scope) {
            scope.cleanup(leave);
            scope.assert.equal(enter(), 1);
            scope.assert.equal(process.pid === ${process.pid}, ${processModel === 'in-process'});
            scope.assert.equal(process.execArgv.includes('--permission'), ${processModel === 'supervised-process'});
            if (index === 0) scope.assert.equal(nextExecution(), 1);
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
        ...processModels.map(function processModelTest(processModel) {
            return createTestCase({
                ...metadata,
                title: `${processModel} preserves its boundary with serial cases and narrowing selection`,
                async body(scope: TestScope) {
                    const { execution } = await createExecutionProject(scope, processModel, serialCases(processModel));
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
                        statuses: [ 'passed', 'passed', processModel === 'in-process' ? 'failed' : 'passed' ],
                        executed: [ 3, 1, 3 ],
                        errors: [ [], [], [] ],
                        repeatedFailures: processModel === 'in-process' ? 1 : 0
                    });
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
                    'throw new Error("collection sentinel");'
                );
                await scope.assert.rejects(async function rejectFirstCollection() {
                    return await execution.run(all);
                }, { cause: { message: 'collection sentinel' } });
                await writeFile(join(cwd, 'case.test.mjs'), serialCases('in-process'));
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
                const { execution } = await createExecutionProject(scope, 'in-process', serialCases('in-process'));
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
            title: 'supervised disposal interrupts collection and awaits the owned child',
            async body(scope) {
                const { execution } = await createExecutionProject(
                    scope,
                    'supervised-process',
                    'await new Promise(() => {});'
                );
                const running = execution.run(all);
                await execution.dispose();
                const result = await running;
                scope.assert.equal(result.status, 'failed');
                scope.assert.equal(result.summary.passed, 0);
                scope.assert.true(result.runnerErrors.some(function cancelled(error) {
                    return error.subtype === 'crash' && error.attributedTo === null &&
                        error.message.includes('cancelled');
                }));
                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testNode, [ createLineReporter() ]);
