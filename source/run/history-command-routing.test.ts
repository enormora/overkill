import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { historyCommandRouting } from '../test-support/history-command-routing.ts';
import { commandLineExitCodes } from './command-line-command.ts';

export const testNode = suite('history command routing and confirmation', [
    test('lists replay availability and preserves unknown durations', async function (scope: TestScope) {
        const fixture = await historyCommandRouting(false, 'none');
        const result = await fixture.commands.list(fixture.request);
        scope.assert.equal(result.exitCode, commandLineExitCodes.pass);
        scope.assert.equal(result.stdoutLines[0], 'ID\tSTARTED\tPROFILE\tFAMILY\tSTATUS\tDURATION (us)\tREPLAY');
        scope.assert.true(result.stdoutLines.some(function (line) {
            return line.startsWith('interrupted\t') && line.endsWith('\t\tavailable-interrupted');
        }));
        scope.assert.deepEqual(fixture.events, [ 'load', 'canonical', 'create:/project' ]);
        return scope.assert.collect();
    }),
    ...([ true, false ] as const).map(function (dryRun) {
        return test(`formats history pruning with dryRun=${String(dryRun)}`, async function (scope: TestScope) {
            const fixture = await historyCommandRouting(false, 'none');
            const result = await fixture.commands.prune({ ...fixture.request, dryRun });
            const action = dryRun ? 'Would remove' : 'Removed';
            scope.assert.deepEqual(result.stdoutLines, [
                `${action} /project/.overkill/runs/old.json`,
                `${action} 1 summaries, 1 cases, 1 work entries.`
            ]);
            scope.assert.deepEqual(result.fallbackDiagnostics, [ 'pruned diagnostic' ]);
            return scope.assert.collect();
        });
    }),
    test('formats compaction results', async function (scope: TestScope) {
        const fixture = await historyCommandRouting(false, 'none');
        const result = await fixture.commands.compact(fixture.request);
        scope.assert.deepEqual(result.stdoutLines, [ 'Compacted 0 retained runs.' ]);
        scope.assert.equal(result.exitCode, commandLineExitCodes.pass);
        return scope.assert.collect();
    }),
    test('leaves history intact when clearing is declined', async function (scope: TestScope) {
        const fixture = await historyCommandRouting(false, 'none');
        const result = await fixture.commands.clear(fixture.request);
        scope.assert.deepEqual(result.stdoutLines, []);
        scope.assert.deepEqual(fixture.removed, []);
        scope.assert.equal(fixture.events.at(-1), 'confirm:false');
        return scope.assert.collect();
    }),
    test('clears history only after confirmation', async function (scope: TestScope) {
        const fixture = await historyCommandRouting(true, 'none');
        const result = await fixture.commands.clear({ ...fixture.request, yes: true });
        scope.assert.deepEqual(result.stdoutLines, [ 'History cleared.' ]);
        scope.assert.equal(fixture.removed.length, 4);
        scope.assert.equal(fixture.events.at(-1), 'confirm:true');
        return scope.assert.collect();
    }),
    ...([ 'load', 'canonical' ] as const).map(function (failure) {
        return test(`reports history ${failure} failures`, async function (scope: TestScope) {
            const fixture = await historyCommandRouting(false, failure);
            const result = await fixture.commands.list(fixture.request);
            scope.assert.equal(result.exitCode, commandLineExitCodes.internalCrash);
            scope.assert.equal(result.runResult, null);
            scope.assert.deepEqual(result.stdoutLines, []);
            return scope.assert.collect();
        });
    })
]);
await runIfMain(import.meta, testNode);
