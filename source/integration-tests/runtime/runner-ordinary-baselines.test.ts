import type { CompositeAssertionReturn } from '@overkill-dev/test/assert';
import { type CompositeCheckBuilder } from '@overkill-dev/test/assert';
import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { execFile } from 'node:child_process';
import { deserialize } from 'node:v8';
import { fileURLToPath } from 'node:url';
import { table, suite, test } from '@overkill-dev/test';

import { orchestrator, type BaselineRunResult } from '../../packages/run/run.entry-point.ts';
import {
    createOrdinaryBaselineFixture,
    ordinaryBaselineFixtureFile as fixture,
    type OrdinaryBaselineFixture
} from '../../test-support/ordinary-baseline-fixture.ts';
import type { OrdinaryBaselineStore } from '../../run/baseline-store.ts';
import type { CoveredBaselineResult } from './support/baseline-coverage-subject.ts';

type BaselineEntries = Awaited<ReturnType<OrdinaryBaselineFixture['entries']>>;
const writtenChecks = (
    check: CompositeCheckBuilder<'assert'>,
    result: BaselineRunResult,
    changes: number
): CompositeAssertionReturn<'assert'> => {
    return check.group([
        check.equal(result.result.status, 'passed'),
        check.deepEqual(result.result.runnerErrors, []),
        check.equal(result.writeOutcome.kind, 'written'),
        check.equal(result.changes.length, changes)
    ]);
};
const assertWritten = defineCompositeAssertion({
    name: 'written',
    assert: writtenChecks
});

const assertReadOnlyChanges = defineCompositeAssertion({
    name: 'read only changes',
    async assert(check, data: OrdinaryBaselineFixture, original: BaselineEntries) {
        data.setActual(43);
        const changed = await orchestrator.run(data.command, { timing: null });
        const initialChecks = check.equal(changed.summary.failed, 2);
        const preview = await orchestrator.baseline.diff(data.command, { timing: null });
        const intermediateChecks = check.group([
            check.equal(preview.writeOutcome.kind, 'read-only'),
            check.equal(preview.changes.length, 2),
            check.deepEqual(await data.entries(), original)
        ]);
        const bootstrap = await orchestrator.baseline.bootstrap(data.command, { timing: null });
        return check.group([
            initialChecks,
            intermediateChecks,
            check.equal(
                bootstrap
                    .writeOutcome
                    .kind,
                'blocked'
            ),
            check.deepEqual(await data.entries(), original)
        ]);
    }
});
async function seedStaleEntries(data: OrdinaryBaselineFixture): Promise<OrdinaryBaselineStore> {
    const store = await data.store();
    const entries = await store.list();
    const [ entry ] = entries;
    if (entry === undefined || entry === null) {
        throw new Error('Expected entry to satisfy defined.');
    }
    for (
        const identity of [
            { title: 'removed', profile: 'unit', adapter: 'output' },
            { title: 'unavailable', profile: 'unit', adapter: 'output' },
            { title: 'removed', profile: 'other', adapter: 'output' },
            { title: 'removed', profile: 'unit', adapter: 'retired' }
        ]
    ) {
        await store.apply({
            kind: 'create',
            baseline: {
                ...entry.baseline,
                profile: identity.profile,
                adapter: identity.adapter,
                work: {
                    ...entry
                        .baseline
                        .work,
                    case: { ...entry.baseline.work.case, title: identity.title }
                }
            }
        });
    }
    return store;
}
const assertCleanupPreview = defineCompositeAssertion({
    name: 'cleanup preview',
    async assert(check, data: OrdinaryBaselineFixture, store: OrdinaryBaselineStore) {
        const compared = await orchestrator.run(data.command, { timing: null });
        const initialChecks = check.equal(compared.status, 'failed');
        const filtered = { ...data.command, request: { ...data.command.request, paths: [ fixture ] } };
        const intermediateChecks = writtenChecks(
            check.annotated('written'),
            await orchestrator.baseline.apply(filtered, { timing: null }),
            0
        );
        const preview = await orchestrator.baseline.diff(data.command, { timing: null });
        const laterChecks = check.equal(preview.changes.length, 1);
        const entries = await store.list();
        return check.group([ initialChecks, intermediateChecks, laterChecks, check.equal(entries.length, 6) ]);
    }
});
const assertEntryCount = defineCompositeAssertion({
    name: 'entry count',
    async assert(check, store: OrdinaryBaselineStore, expected: number) {
        const entries = await store.list();
        return check.group([ check.equal(entries.length, expected) ]);
    }
});
async function coveredBaselines(directory: string): Promise<CoveredBaselineResult> {
    const output = await new Promise<string>(function executeCoverage(resolve, reject) {
        execFile(
            process.execPath,
            [
                '--allow-inspector',
                fileURLToPath(new URL('./support/baseline-coverage-subject.ts', import.meta.url)),
                directory
            ],
            { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 },
            function collectResult(error, stdout, stderr) {
                if (error === null) {
                    resolve(stdout);
                } else {
                    reject(new Error(stderr, { cause: error }));
                }
            }
        );
    });
    return deserialize(Buffer.from(output, 'base64')) as CoveredBaselineResult;
}

export const testNode = suite('ordinary baseline workflows', [
    test('reconciles ordinary baselines under in-process coverage', async function (scope) {
        const data = await createOrdinaryBaselineFixture(scope.cleanup, 'in-process', 'text');
        const result = await coveredBaselines(data.directory);
        scope.assert(assertWritten, result.updated, 2);
        scope.assert.equal(result.compared.summary.failed, 2);
        scope.assert.deepEqual(result.retained, result.original);
        return scope.assert.collect();
    }),
    table({
        title: 'reconciles ordinary baselines across execution placements',
        cases: [ 'in-process', 'supervised-process', 'worker-pool' ] as const,
        caseTitle(execution) {
            return execution;
        },
        async test(scope) {
            const execution = scope.parameters;

            const data = await createOrdinaryBaselineFixture(
                scope.cleanup,
                execution,
                execution === 'in-process' ? 'text' : 'binary'
            );

            const establishBaselinesMissing = await orchestrator.run(data.command, { timing: null });
            scope.assert.equal(establishBaselinesMissing.summary.failed, 2);
            scope.assert(assertWritten, await orchestrator.baseline.bootstrap(data.command, { timing: null }), 2);
            const establishBaselinesCompared = await orchestrator.run(data.command, { timing: null });
            scope.assert.equal(establishBaselinesCompared.status, 'passed');

            const diskOnlyListObserved = data.observations();
            const diskOnlyListEntries = await data.entries();
            scope.assert.equal(diskOnlyListEntries.length, 2);
            scope.assert.equal(data.observations(), diskOnlyListObserved);
            const original = diskOnlyListEntries;

            await scope.assert(assertReadOnlyChanges, data, original);
            scope.assert(assertWritten, await orchestrator.baseline.update(data.command, { timing: null }), 2);
            const compared = await orchestrator.run(data.command, { timing: null });
            scope.assert.equal(compared.status, 'passed');
            return scope.assert.collect();
        }
    }),
    test(
        'cleans only complete selected inventories and preserves skipped and foreign entries',
        async function (scope) {
            const data = await createOrdinaryBaselineFixture(scope.cleanup, 'in-process', 'text');
            scope.assert(assertWritten, await orchestrator.baseline.update(data.command, { timing: null }), 2);
            const store = await seedStaleEntries(data);
            await scope.assert(assertCleanupPreview, data, store);
            scope.assert(assertWritten, await orchestrator.baseline.update(data.command, { timing: null }), 0);
            await scope.assert(assertEntryCount, store, 6);
            scope.assert(assertWritten, await orchestrator.baseline.apply(data.command, { timing: null }), 1);
            await scope.assert(assertEntryCount, store, 5);
            return scope.assert.collect();
        }
    )
]);
