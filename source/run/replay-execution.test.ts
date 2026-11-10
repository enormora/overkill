import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { withCoverageRecordFixture } from '../test-support/coverage-record-fixture.ts';
import { defaultMicrotestProfile, defaultRunConfig } from '../test-support/run-command-factory.ts';
import { createDeterministicRunTestModuleLoader } from '../test-support/deterministic-run-fixtures.ts';
import type { ReplayRunRecord } from './replay-record-types.ts';
import { startSupervisedChild } from './node-child-process-starters.ts';
import { replayRecordSchema } from './replay-record-schema.ts';
import type { RunnerResult, DiscoveredRunFile } from './run-types.ts';
import { createRunCoordinator } from './run.ts';

const sourceFile = 'source/integration-tests/run/fixtures/passing.test.ts';
const config = defaultRunConfig({
    profiles: {
        microtest: defaultMicrotestProfile({
            execution: { processModel: 'in-process', scheduling: 'serial' },
            processUsage: { measure: false }
        })
    }
});

function retainedRecord(files: ReadonlyMap<string, string>): ReplayRunRecord {
    const encoded = Array.from(files.values()).find(function record(content) {
        return replayRecordSchema.safeParse(JSON.parse(content)).success;
    });
    if (encoded === undefined) {
        throw new Error('Expected retained run.');
    }
    return replayRecordSchema.parse(JSON.parse(encoded));
}
function assertReplayedWork(
    scope: TestScope,
    original: RunnerResult,
    replayed: RunnerResult,
    record: ReplayRunRecord
): void {
    scope.assert.deepEqual(replayed.runnerErrors, []);
    scope.assert.equal(original.summary.passed, 1);
    scope.assert.equal(replayed.summary.passed, 1);
    scope.assert.equal(replayed.summary.defined, record.replayPlan.defined);
    scope.assert.deepEqual(
        replayed.perTest.map(function identity(result) {
            return result.workId;
        }),
        record.identities
    );
}
export const testNode = suite('public replay execution', [
    test('restores a recorded selection without invoking current discovery', async function (scope: TestScope) {
        await withCoverageRecordFixture(config, [], async function recordedProject(fixture) {
            const files = new Map<string, string>();
            let replaying = false;
            const { orchestrator } = createRunCoordinator({
                ...fixture.request.dependencies,
                startSupervisedChild,
                runtimeStateStore: {
                    async read(file) {
                        return files.get(file) ?? null;
                    },
                    async write(file, content) {
                        files.set(file, content);
                        await fixture.request.dependencies.runtimeStateStore.write(file, content);
                    }
                },
                async discoverRunFilesWithProjectRoot(request) {
                    if (replaying) {
                        throw new Error('Replay rediscovered the project.');
                    }
                    return {
                        projectRoot: request.cwd,
                        files: [ {
                            file: sourceFile,
                            fileSet: null,
                            href: `virtual:${sourceFile}`,
                            path: `${request.cwd}/${sourceFile}`
                        } ]
                    };
                },
                async loadRunTestModules(modules, engine) {
                    const load = createDeterministicRunTestModuleLoader({
                        recordLoadEnvironmentMutation() {
                            return undefined;
                        }
                    });
                    const asVirtual = function fixtureSource(file: DiscoveredRunFile): DiscoveredRunFile {
                        return { ...file, href: `virtual:${file.file}` };
                    };
                    return await load([ asVirtual(modules[0]), ...modules.slice(1).map(asVirtual) ], engine);
                }
            });
            const command = {
                ...fixture.request.command,
                request: {
                    ...fixture.request.command.request,
                    coverage: false,
                    record: true,
                    paths: [ sourceFile ]
                }
            };
            const original = await orchestrator.run(command);
            const record = retainedRecord(files);
            replaying = true;
            const replayed = await orchestrator.replay({
                debug: { mode: 'off', selectors: [] },
                cwd: command.cwd,
                config: command.config,
                signal: null,
                runId: record.id
            });
            assertReplayedWork(scope, original, replayed, record);
        });
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
