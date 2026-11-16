import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { normalizeConfig, type IntegrationProfileConfig } from '../packages/run/run.entry-point.ts';
import { defaultAttachmentLimits } from '../engine/runtime-attachment.ts';
import { attachmentFixture } from '../test-support/attachment-fixture.ts';
import { defaultMicrotestProfile, defaultRunRequest } from '../test-support/run-command-factory.ts';
import { storedSnapshot } from '../test-support/snapshot-fixture.ts';
import type { ResolvedRunInput } from './run-input-resolution.ts';
import { createOrdinaryBaselineStore } from './baseline-store.ts';
import { currentSnapshotRun } from './execution-session-context.ts';
import { withSnapshotRun } from './snapshot-preparation.ts';

type PreparationInput = ResolvedRunInput & { readonly profile: IntegrationProfileConfig; };

async function preparationInput(scope: TestScope): Promise<PreparationInput> {
    const { directory } = await attachmentFixture(scope, defaultAttachmentLimits);
    const config = normalizeConfig({
        profiles: {
            integration: {
                testFamily: 'integration',
                baselines: { snapshots: true, directory },
                files: { include: [ 'source/run/snapshot-preparation.test.ts' ] }
            }
        }
    });
    const profile = config.profiles.integration;
    scope.require.defined(profile);
    if (profile.testFamily !== 'integration') {
        throw new TypeError('Expected the integration profile.');
    }
    return {
        benchmarkPurpose: 'compare',
        benchmarkHost: null,
        benchmarkCalibration: null,
        benchmarkNormalization: null,
        config,
        profile,
        engine: { kind: 'default' },
        files: [ {
            file: 'source/run/snapshot-preparation.test.ts',
            fileSet: null,
            href: import.meta.url,
            path: import.meta.filename
        } ],
        projectRoot: process.cwd(),
        request: defaultRunRequest({ profile: 'integration', baselineUpdateMode: 'update' })
    };
}

export const testNode = suite('snapshot preparation', [
    test(
        'loads compatible expectations for the requested profile and restores context',
        async function (scope: TestScope) {
            const input = await preparationInput(scope);
            const baseline = storedSnapshot({ kind: 'text', name: 'response', actual: 'hello' });
            const store = await createOrdinaryBaselineStore({
                directory: input.profile.baselines.directory,
                projectRoot: input.projectRoot,
                maxBytes: 1_048_576
            });
            for (
                const record of [
                    baseline,
                    { ...baseline, profile: 'foreign' },
                    { ...baseline, adapter: 'custom' },
                    { ...baseline, subtype: 'terminal-snapshot' as const },
                    { ...baseline, comparisonContext: { ...baseline.comparisonContext, codec: '2' } }
                ]
            ) {
                await store.apply({ kind: 'create', baseline: record });
            }
            const active = await withSnapshotRun(input, async function inspectExpectations() {
                scope.assert.equal(currentSnapshotRun()?.profile, 'integration');
                return currentSnapshotRun();
            });
            scope.require.notNull(active);
            scope.assert.deepEqual(
                { entries: active.entries, mode: active.mode, outside: currentSnapshotRun() },
                { entries: [ baseline ], mode: 'update', outside: null }
            );
            return scope.assert.collect();
        }
    ),
    test('runs disabled snapshots without installing expectations', async function (scope: TestScope) {
        const input = await preparationInput(scope);
        const profile = defaultMicrotestProfile();
        const value = await withSnapshotRun({ ...input, profile }, async function disabledRun() {
            scope.assert.equal(currentSnapshotRun(), null);
            return 'completed';
        });
        scope.assert.equal(value, 'completed');
        return scope.assert.collect();
    }),
    test('rejects enabled snapshots on a strict profile', async function (scope: TestScope) {
        const input = await preparationInput(scope);
        const profile = {
            ...defaultMicrotestProfile(),
            baselines: { adapters: [], directory: 'unused', snapshots: true, stale: 'fail' as const }
        };
        await scope.assert.rejects(async function invalidProfile() {
            await withSnapshotRun({ ...input, profile }, async function unexpectedRun() {
                throw new Error('Strict snapshot execution must not start.');
            });
        }, { message: 'Snapshots require an integration profile.' });
        return scope.assert.collect();
    })
]);
