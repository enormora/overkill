import { suite, test } from '@overkill-dev/test';

import { planningInput } from '../test-support/benchmark-plan-input.ts';
import { frozenMicrotestPolicy } from '../test-support/frozen-microtest-policy.ts';
import { defaultRunConfig, defaultMicrotestProfile } from '../test-support/run-command-factory.ts';
import { configuredFilesRunCollectionSource } from './run-collection-source.ts';
import { withExecutionSession } from './execution-session-context.ts';
import {
    createSupervisedCollectCommand,
    createSupervisedRunCommand,
    createWorkerPoolCommand
} from './run-isolated-command.ts';

export const testNode = suite('isolated command transport policy', [
    test('preserves benchmark collection policy and resolves an absent seed', function (scope) {
        const input = planningInput();
        const command = {
            config: defaultRunConfig({ profiles: { sizes: input.profile } }),
            cwd: input.projectRoot,
            engine: { kind: 'default' as const },
            request: { ...input.request, seed: { value: null } }
        };
        const context = {
            projectRoot: input.projectRoot,
            normalization: null,
            source: configuredFilesRunCollectionSource
        };
        const supervised = createSupervisedRunCommand(command, input.profile, input.files, context);
        const worker = createWorkerPoolCommand({
            ...input,
            command,
            source: context.source,
            benchmarkNormalization: null,
            definitionLocationCapture: 'disabled'
        });
        scope.assert.deepEqual({
            seed: supervised.seed,
            garbage: supervised.benchmarkGarbageCollection,
            capabilities: supervised.capabilityRestrictions
        }, {
            seed: '0',
            garbage: input.profile.testFamily === 'benchmark' ? input.profile.garbageCollection : null,
            capabilities: { mode: 'disabled' }
        });
        scope.assert.equal(worker.seed, '0');
        scope.assert.deepEqual<unknown, unknown>({ garbage: worker.benchmarkGarbageCollection }, {
            garbage: supervised.benchmarkGarbageCollection
        });
        return scope.assert.collect();
    }),
    test(
        'encodes frozen collection, ordinary execution and session execution distinctly',
        async function (scope) {
            const input = planningInput();
            const policy = await frozenMicrotestPolicy();
            const profile = defaultMicrotestProfile();
            const command = {
                config: defaultRunConfig({ profiles: { unit: profile } }),
                cwd: input.projectRoot,
                engine: { kind: 'default' as const },
                request: input.request
            };
            const context = {
                projectRoot: input.projectRoot,
                normalization: null,
                source: { kind: 'frozen-policy' as const, policy }
            };
            scope.assert.equal(
                createSupervisedCollectCommand(command, profile, input.files, context).kind,
                'collect-frozen'
            );
            scope.assert.equal(createSupervisedRunCommand(command, profile, input.files, context).kind, 'run-frozen');
            const transport = {
                lifecycle: { moduleUrl: 'file:///project/lifecycle.ts', exportName: 'create' },
                data: { value: 1 }
            };
            await withExecutionSession(transport, async function () {
                const result = createSupervisedRunCommand(command, profile, input.files, context);
                scope.assert.partialDeepEqual<unknown, unknown>(result, {
                    kind: 'run-session',
                    policy,
                    session: transport
                });
            });
            return scope.assert.collect();
        }
    )
]);
