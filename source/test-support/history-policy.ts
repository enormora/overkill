import { openHistory, type HistoryRuntime } from '../run/history.ts';
import type { History, HistoryPruneRequest } from '../run/history-types.ts';
import type { DetailedRecordState } from '../run/history-state-access.ts';
import { repairHistory } from '../run/history-repair.ts';
import { emptyCompactHistory } from '../run/compact-history.ts';
import { memoryHistoryAccess, type HistoryAccessScenario } from './history-access.ts';

type HistoryPolicyFixture = {
    readonly history: History;
    readonly runtime: HistoryRuntime;
    readonly removed: readonly string[];
    readonly pruned: readonly HistoryPruneRequest[];
};
const now = '2026-10-30T00:00:00.000Z';
export async function historyPolicy(
    scenario: HistoryAccessScenario,
    availability: DetailedRecordState,
    indexState: 'current' | 'legacy' | 'missing'
): Promise<HistoryPolicyFixture> {
    const fixture = await memoryHistoryAccess(scenario);
    const removed: string[] = [];
    const pruned: HistoryPruneRequest[] = [];
    if (indexState !== 'missing') {
        await fixture.store.write(
            '/project/.overkill/history/index.json',
            JSON.stringify({
                ...emptyCompactHistory(now),
                version: indexState === 'legacy' ? 0 : 1,
                summaries: [ {
                    id: 'passed',
                    startedAt: now,
                    profile: 'unit',
                    testFamily: 'microtest',
                    status: 'passed',
                    durationMicroseconds: 42,
                    replayable: true
                }, {
                    id: 'interrupted',
                    startedAt: now,
                    profile: 'unit',
                    testFamily: 'microtest',
                    status: 'interrupted',
                    durationMicroseconds: null,
                    replayable: true
                }, {
                    id: 'without-replay',
                    startedAt: now,
                    profile: 'unit',
                    testFamily: 'microtest',
                    status: 'passed',
                    durationMicroseconds: 0,
                    replayable: false
                } ]
            })
        );
    }
    const runtime: HistoryRuntime = {
        now() {
            return now;
        },
        async inspect() {
            return availability;
        },
        repair: repairHistory,
        async remove(path) {
            removed.push(path);
        },
        async prune(_context, request) {
            pruned.push(request);
            return {
                kind: request.dryRun ? 'dry-run' : 'applied',
                paths: [ '/project/.overkill/runs/old.json' ],
                diagnostics: [ 'pruned diagnostic' ],
                removedSummaries: 1,
                removedCases: 1,
                removedWorkEntries: 1
            };
        }
    };
    return { runtime, removed, pruned, history: openHistory(fixture.access, runtime) };
}
