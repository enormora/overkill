import { suite, test } from '../test/test.entry-point.ts';
import { normalizeConfig } from '../run/run.entry-point.ts';
import { createDeterministicRunOrchestrator } from '../../test-support/create-deterministic-run-orchestrator.ts';
import type { TestScope } from '../engine/engine.entry-point.ts';
import { createMutationRunCommand } from './mutation-execution-policy.ts';
import { selectMicrotestProfile } from './microtest-profile.ts';

const fixture = 'source/integration-tests/run/fixtures/passing.test.ts';

export const testNode = suite('mutation execution policy', [
    test('preserves configured policy while resolving explicit serial intent', async function (scope) {
        for (const processModel of [ 'in-process', 'supervised-process' ] as const) {
            for (const scheduling of [ 'concurrent', 'serial' ] as const) {
                const config = normalizeConfig({
                    loader: { sourceMaps: true, stripMode: 'strip-only' },
                    profiles: {
                        unit: {
                            testFamily: 'microtest',
                            files: { sets: { unit: { include: [ fixture ] } } },
                            execution: { processModel, scheduling, maxConcurrency: 3 },
                            resourceUsage: { measure: true, budgets: { residentSetBytes: 100_000_000 } },
                            timeouts: { softMilliseconds: 50, hardMilliseconds: 100 },
                            timings: { collection: 'precise' },
                            coverage: { outputs: [ 'json' ] }
                        }
                    }
                });
                const command = createMutationRunCommand({ config, cwd: process.cwd(), profile: 'unit' });
                const { profile } = selectMicrotestProfile(config, 'unit');
                const resolved = await createDeterministicRunOrchestrator().resolve({
                    ...command,
                    request: { ...command.request, paths: [ fixture ] }
                });

                scope.assert.equal(command.config, config);
                scope.assert.deepEqual({
                    paths: command.request.paths,
                    selection: command.request.selection,
                    shard: command.request.shard,
                    capabilities: command.request.capabilityRestrictions,
                    execution: resolved.request.execution
                }, {
                    paths: [],
                    selection: { kind: 'all' },
                    shard: { index: 1, total: 1 },
                    capabilities: { mode: 'enabled' },
                    execution: { mode: 'serial' }
                });
                scope.assert.deepEqual({
                    configuredScheduling: selectMicrotestProfile(resolved.config, 'unit').profile.execution.scheduling,
                    files: selectMicrotestProfile(resolved.config, 'unit').profile.files,
                    loader: resolved.facts.loader,
                    execution: {
                        scheduling: resolved.facts.execution.scheduling,
                        processModel: resolved.facts.execution.processModel,
                        maxConcurrency: resolved.facts.execution.maxConcurrency,
                        resourceUsagePolicy: resolved.facts.execution.resourceUsagePolicy,
                        timeoutPolicy: resolved.facts.execution.timeoutPolicy,
                        timingCollection: resolved.facts.execution.timingCollection,
                        retries: resolved.facts.execution.retries,
                        coverage: resolved.facts.execution.coverage,
                        baselineUpdateMode: resolved.facts.execution.baselineUpdateMode
                    },
                    coveragePolicy: resolved.facts.coveragePolicy
                }, {
                    configuredScheduling: scheduling,
                    files: profile.files,
                    loader: config.loader,
                    execution: {
                        scheduling: 'serial',
                        processModel,
                        maxConcurrency: 3,
                        resourceUsagePolicy: profile.resourceUsage,
                        timeoutPolicy: profile.timeouts,
                        timingCollection: 'precise',
                        retries: null,
                        coverage: false,
                        baselineUpdateMode: 'none'
                    },
                    coveragePolicy: null
                });
            }
        }

        return scope.assert.collect();
    }),
    test('serial request intent leaves ordinary coverage available', async function (scope: TestScope) {
        const config = normalizeConfig({ profiles: { unit: { testFamily: 'microtest' } } });
        const command = createMutationRunCommand({ config, cwd: process.cwd(), profile: 'unit' });
        const resolved = await createDeterministicRunOrchestrator().resolve({
            ...command,
            request: { ...command.request, coverage: true, paths: [ fixture ] }
        });

        scope.assert.equal(resolved.facts.execution.coverage, true);
        scope.require.defined(resolved.facts.coveragePolicy);
        scope.assert.deepEqual(resolved.facts.coveragePolicy, selectMicrotestProfile(config, 'unit').profile.coverage);
        scope.assert.equal(resolved.facts.execution.scheduling, 'serial');
        return scope.assert.collect();
    })
]);
