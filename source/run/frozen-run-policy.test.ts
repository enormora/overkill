import { suite, test } from '../packages/test/test.entry-point.ts';
import { normalizeConfig } from '../packages/run/config.entry-point.ts';
import { orchestrator, parseFrozenMicrotestPolicy, type RunCommand } from '../packages/run/run.entry-point.ts';
import { createMutationRunCommand } from '../packages/stryker-runner/mutation-execution-policy.ts';
import { defaultRunEngine } from './default-run-engine.ts';
import { policyBaselineCommand } from './frozen-run-policy.ts';
import { createSupervisedRunCommand } from './run-isolated-command.ts';
import { frozenSupervisedCommandSchema } from './frozen-supervised-command-schema.ts';

const file = 'source/integration-tests/run/fixtures/throws-on-import.test.ts';

function command(): RunCommand {
    return createMutationRunCommand({
        cwd: process.cwd(),
        profile: 'unit',
        config: normalizeConfig({ profiles: { unit: { testFamily: 'microtest', files: { include: [ file ] } } } })
    });
}

export const testNode = suite('frozen microtest policy', [
    test('freezes discovery without importing tests or a custom engine', async function (scope) {
        const engineModule = new URL('./absent-engine.ts', import.meta.url);
        const input = {
            ...command(),
            engine: {
                kind: 'module',
                moduleUrl: engineModule.href,
                exportName: 'engine',
                exportKind: 'value'
            }
        } as const;
        const policy = await orchestrator.freezePolicy({ command: input, source: { kind: 'memory' } });
        scope.assert.deepEqual(
            policy.files.map(function discoveredFile(descriptor) {
                return descriptor.file;
            }),
            [ file ]
        );
        scope.assert.equal(Object.hasOwn(policy.request, 'seed'), false);
        scope.assert.equal(Object.hasOwn(policy.profile, 'reporters'), false);
        scope.assert.equal(Object.isFrozen(policy.profile.execution), true);
        const serialized = JSON.stringify(policy);
        scope.assert.deepEqual(parseFrozenMicrotestPolicy(JSON.parse(serialized)), policy);
        return scope.assert.collect();
    }),
    test('rejects malformed and conflicting discovery descriptors', async function (scope) {
        const policy = await orchestrator.freezePolicy({ command: command(), source: { kind: 'memory' } });
        const [ descriptor ] = policy.files;
        for (
            const files of [
                [],
                [ descriptor, descriptor ],
                [ { ...descriptor, path: '/outside.test.ts' } ],
                [ { ...descriptor, href: 'file:///outside.test.ts' } ],
                [ { ...descriptor, file: '../outside.test.ts' } ],
                [ { ...descriptor, file: descriptor.path } ],
                [ { ...descriptor, fileSet: 'absent' } ]
            ]
        ) {
            scope.assert.throws(function rejectDescriptor() {
                parseFrozenMicrotestPolicy({ ...policy, files });
            }, { type: Error });
        }
        scope.assert.throws(function rejectExtraPolicy() {
            parseFrozenMicrotestPolicy({ ...policy, retry: true });
        }, { type: Error });
        return scope.assert.collect();
    }),
    test('rejects conflicting supervised permissions before collection', async function (scope) {
        const policy = await orchestrator.freezePolicy({ command: command(), source: { kind: 'memory' } });
        const supervised = createSupervisedRunCommand(
            policyBaselineCommand(policy),
            { ...policy.profile, reporters: null },
            policy.files,
            { kind: 'frozen-policy', policy }
        );
        const wire = JSON.stringify(supervised);
        const transported: unknown = JSON.parse(wire);
        scope.assert.deepEqual(frozenSupervisedCommandSchema.parse(transported), transported);
        scope.assert.throws(function rejectWeakenedPermissions() {
            frozenSupervisedCommandSchema.parse({ ...supervised, capabilityRestrictions: { mode: 'disabled' } });
        }, { message: /conflicts with frozen policy/ });
        scope.assert.throws(function rejectWeakenedResources() {
            frozenSupervisedCommandSchema.parse({
                ...supervised,
                resourceUsageSamplingIntervalMilliseconds: 999
            });
        }, { message: /conflicts with frozen policy/ });
        return scope.assert.collect();
    }),
    test('invocation selection cannot enlarge frozen eligibility', async function (scope) {
        const input = command();
        const config = normalizeConfig({
            profiles: {
                unit: {
                    testFamily: 'microtest',
                    files: { include: [ 'source/integration-tests/run/fixtures/selection.test.ts' ] },
                    execution: { processModel: 'in-process' }
                }
            }
        });
        const policy = await orchestrator.freezePolicy({
            command: {
                ...input,
                config,
                request: {
                    ...input.request,
                    selection: {
                        kind: 'filter',
                        filter: { kind: 'equals', field: 'tag', value: 'Fast' }
                    }
                }
            },
            source: { kind: 'memory' }
        });
        const resolved = await orchestrator.resolve({
            kind: 'frozen-policy',
            policy,
            reporting: config,
            invocation: { seed: { value: 7n }, selection: { kind: 'all' } }
        });
        scope.assert.deepEqual(
            resolved.facts.cases.map(function eligibleTitle(testCase) {
                return testCase.id.title;
            }),
            [ 'charges card' ]
        );
        scope.assert.equal(resolved.request.seed.value, 7n);
        await scope.assert.rejects(async function rejectDisjointInvocation() {
            await orchestrator.resolve({
                kind: 'frozen-policy',
                policy,
                reporting: config,
                invocation: {
                    seed: { value: 7n },
                    selection: { kind: 'filter', filter: { kind: 'equals', field: 'tag', value: 'Slow' } }
                }
            });
        }, { message: /matched no test cases/ });
        return scope.assert.collect();
    }),
    test('rejects non-microtest policy and engine instances before discovery', async function (scope) {
        const config = normalizeConfig({
            profiles: { unit: { testFamily: 'integration', files: { include: [ file ] } } }
        });
        await scope.assert.rejects(async function freezeIntegration() {
            await orchestrator.freezePolicy({ command: { ...command(), config }, source: { kind: 'memory' } });
        }, { message: /requires a Node microtest profile/ });
        await scope.assert.rejects(async function freezeInstance() {
            await orchestrator.freezePolicy({
                command: { ...command(), engine: { kind: 'instance', engine: defaultRunEngine } },
                source: { kind: 'memory' }
            });
        }, { message: /portable engine/ });
        return scope.assert.collect();
    })
]);

const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
