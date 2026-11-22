import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import {
    type CompositeAssertionReturn,
    type CompositeCheckBuilder,
    defineCompositeAssertion
} from '@overkill-dev/test/assert';
import { defineMacro, type TestScope, suite, table, test } from '@overkill-dev/test';

import { normalizeConfig, orchestrator, type RunCommand } from '../../packages/run/run.entry-point.ts';
import { defaultRunRequest } from '../../test-support/run-command-factory.ts';
import { createOrdinaryBaselineStore, type OrdinaryBaselineStore } from '../../run/baseline-store.ts';

type SnapshotFixture = { readonly command: RunCommand; readonly store: OrdinaryBaselineStore; };
type SnapshotExecution = 'supervised-process' | 'worker-pool';
const fixtureFile = 'source/integration-tests/runtime/fixtures/content-snapshots.test.ts';

async function createSnapshotFixture(
    cleanup: TestScope['cleanup'],
    processModel: SnapshotExecution,
    file: string
): Promise<SnapshotFixture> {
    await mkdir('target', { recursive: true });
    const directory = await mkdtemp('target/content-snapshots-');
    cleanup(async function removeFixture() {
        await rm(directory, { recursive: true, force: true });
    });
    const config = normalizeConfig({
        runtimeStateDir: `${directory}/runtime`,
        profiles: {
            snapshots: {
                testFamily: 'integration',
                files: { include: [ file ] },
                baselines: { snapshots: true, directory },
                execution: { processModel },
                timeouts: { collectionMilliseconds: 120_000, softMilliseconds: 120_000, hardMilliseconds: 180_000 }
            }
        }
    });
    return {
        command: {
            config: { ...config, reporters: [] },
            cwd: process.cwd(),
            engine: { kind: 'default' },
            request: defaultRunRequest({ profile: 'snapshots' })
        },
        store: await createOrdinaryBaselineStore({ directory, projectRoot: process.cwd(), maxBytes: 1_048_576 })
    };
}

const establishSnapshots = defineCompositeAssertion({
    name: 'establish snapshots',
    async assert(check, fixture: SnapshotFixture) {
        const missing = await orchestrator.run(fixture.command, { timing: null });
        const initialChecks = check.equal(missing.status, 'failed');
        const bootstrap = await orchestrator.baseline.bootstrap(fixture.command, { timing: null });
        const intermediateChecks = check.group([
            check.deepEqual(bootstrap.result.runnerErrors, []),
            check.equal(bootstrap.result.status, 'passed'),
            check.equal(bootstrap.changes.length, 3)
        ]);
        const matching = await orchestrator.run(fixture.command, { timing: null });
        return check.group([
            initialChecks,
            intermediateChecks,
            check.deepEqual(matching.runnerErrors, []),
            check.equal(matching.status, 'passed')
        ]);
    }
});

const verifyReadOnlyMismatchChecks = async function (
    check: CompositeCheckBuilder<'assert'>,
    fixture: SnapshotFixture
): Promise<CompositeAssertionReturn<'assert'>> {
    const before = await fixture.store.list();
    const changed = await orchestrator.run(fixture.command, { timing: null });
    const initialChecks = check.equal(changed.status, 'failed');
    const preview = await orchestrator.baseline.diff(fixture.command, { timing: null });
    const intermediateChecks = check.group([
        check.equal(preview.writeOutcome.kind, 'read-only'),
        check.equal(preview.changes.length, 1)
    ]);
    const bootstrap = await orchestrator.baseline.bootstrap(fixture.command, { timing: null });
    return check.group([
        initialChecks,
        intermediateChecks,
        check.equal(bootstrap.writeOutcome.kind, 'blocked'),
        check.deepEqual(await fixture.store.list(), before)
    ]);
};

const updateChangedSnapshot = defineCompositeAssertion({
    name: 'update changed snapshot',
    async assert(check, fixture: SnapshotFixture) {
        const entries = await fixture.store.list();
        const entry = entries.find(function textSnapshot(candidate) {
            return candidate.baseline.comparisonContext.name === 'response';
        });
        if (entry === undefined) {
            return check.defined(entry);
        }

        await fixture.store.apply({
            kind: 'update',
            previous: entry.baseline,
            baseline: {
                ...entry.baseline,
                payload: { kind: 'text', text: 'changed expectation' }
            }
        });
        const intermediateChecks = await verifyReadOnlyMismatchChecks(
            check.annotated('verify read only mismatch'),
            fixture
        );
        const updated = await orchestrator.baseline.update(fixture.command, { timing: null });
        return check.group([
            intermediateChecks,
            check.equal(
                updated
                    .result
                    .status,
                'passed'
            ),
            check.equal(updated.changes.length, 1)
        ]);
    }
});

async function retireSnapshotName(fixture: SnapshotFixture): Promise<void> {
    const [ entry ] = await fixture.store.list();
    if (entry === undefined) {
        throw new Error('Expected the saved snapshot.');
    }

    await fixture.store.apply({
        kind: 'create',
        baseline: {
            ...entry.baseline,
            comparisonContext: { ...entry.baseline.comparisonContext, name: 'removed-name' }
        }
    });
}

const reconcileSnapshotNames = defineCompositeAssertion({
    name: 'reconcile snapshot names',
    async assert(check, fixture: SnapshotFixture) {
        await retireSnapshotName(fixture);
        const filtered = { ...fixture.command, request: { ...fixture.command.request, paths: [ fixtureFile ] } };
        const preserved = await orchestrator.baseline.apply(filtered, { timing: null });
        const intermediateChecks = check.equal(preserved.changes.length, 0);
        const preview = await orchestrator.baseline.diff(fixture.command, { timing: null });
        const laterChecks = check.equal(preview.changes[0]?.kind, 'remove');
        const applied = await orchestrator.baseline.apply(fixture.command, { timing: null });
        return check.group([ intermediateChecks, laterChecks, check.equal(applied.changes.length, 1) ]);
    }
});

const rejectInvalidSnapshot = defineMacro(function (title: string) {
    return test(title, async function (scope) {
        const fixture = await createSnapshotFixture(
            scope.cleanup,
            'supervised-process',
            'source/integration-tests/runtime/fixtures/invalid-content-snapshot.test.ts'
        );
        const result = await orchestrator.baseline.update(fixture.command, { timing: null });
        await scope.assert(defineCompositeAssertion({
            name: 'blocks snapshot publication after a caught infrastructure failure',
            async assert(check) {
                return check.group([
                    check.equal(result.result.status, 'failed'),
                    check.equal(result.writeOutcome.kind, 'blocked'),
                    check.equal(result.changes.length, 1),
                    check.true(result.result.runnerErrors.some(function artifactFailure(error) {
                        return error.subtype === 'artifact' && error.attributedTo?.title === 'duplicate snapshot names';
                    })),
                    check.deepEqual(await fixture.store.list(), [])
                ]);
            }
        }));

        return scope.assert.collect();
    });
});

export const testNode = suite('content snapshot workflow', [
    table({
        title: 'compares and updates snapshots across process boundaries',
        cases: [ 'supervised-process', 'worker-pool' ] as const,
        caseTitle: String,
        async test(scope) {
            const fixture = await createSnapshotFixture(scope.cleanup, scope.parameters, fixtureFile);
            await scope.assert(establishSnapshots, fixture);
            await scope.assert(updateChangedSnapshot, fixture);
            await scope.assert(reconcileSnapshotNames, fixture);
            return scope.assert.collect();
        }
    }),
    rejectInvalidSnapshot('blocks publication after a caught snapshot infrastructure failure')
]);
