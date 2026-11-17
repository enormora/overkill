import {
    currentResourceCheckDelivery,
    resourceCheckExecutionRunId,
    withResourceCheckDelivery,
    type ResourceCheckDelivery
} from '../resource-check-delivery.ts';
import { resourceCheckSnapshotKey, mergeResourceCheckSnapshots } from '../resource-check-snapshot.ts';
import type { ResourceCheckSnapshot } from '../resource-check-protocol.ts';
import { createStoredValue } from '../stored-value.ts';
import { workIdentityKey } from './identity.ts';
import type { TestPlan } from './test-plan.ts';
import type { RunResult, RunnerError } from './run-result.ts';
import type { ReporterDelivery } from './reporter-dispatcher.ts';
import type { TestRuntimePolicy } from './case-execution-context.ts';

type ResourceCheckReporting = {
    readonly delivery: ResourceCheckDelivery;
    readonly finish: (result: RunResult, policy: TestRuntimePolicy | null) => RunResult;
};
function createResourceCheckReporting(
    reporter: Pick<ReporterDelivery, 'reportEvent'>,
    plan: TestPlan
): ResourceCheckReporting {
    const current = currentResourceCheckDelivery();
    const upstream = current?.kind === 'transport' ? current : null;
    const retention = {
        snapshots: new Map<string, ResourceCheckSnapshot>(),
        owners: new Set<string>(),
        selected: new Set(plan.cases.map(function selectedWork(testCase) {
            return workIdentityKey(testCase.workId);
        }))
    };
    const errors: RunnerError[] = [];
    const pending = createStoredValue(Promise.resolve());
    const finished = createStoredValue(false);
    async function publish(previous: Promise<void>, snapshot: ResourceCheckSnapshot): Promise<void> {
        await previous;
        errors.push(...await reporter.reportEvent({ kind: 'resource-check-progress', snapshot }));
    }
    function checkpoint(snapshot: ResourceCheckSnapshot): void {
        if (!retention.owners.has(snapshot.owner.id)) {
            return;
        }
        retention.snapshots.set(resourceCheckSnapshotKey(snapshot), snapshot);
        upstream?.checkpoint(snapshot);
        if (!finished.read()) {
            pending.write(publish(pending.read(), snapshot));
        }
    }
    const delivery: ResourceCheckDelivery = {
        kind: 'execution',
        run: upstream?.run ?? resourceCheckExecutionRunId(),
        register(owner, resource, consumers, finalize) {
            if (
                consumers.every(function selected(work) {
                    return !retention.selected.has(workIdentityKey(work));
                })
            ) {
                return;
            }
            retention.owners.add(owner.id);
            upstream?.register(owner, resource, consumers, finalize);
            checkpoint({
                owner,
                resource,
                revision: 0,
                interval: { kind: 'lifetime' },
                passing: 0,
                failures: [],
                errors: [],
                status: { kind: 'open' }
            });
        },
        checkpoint,
        stop(owner, interval, cause) {
            if (retention.owners.has(owner.id)) {
                upstream?.stop(owner, interval, cause);
            }
        },
        active(interval, cancel) {
            return upstream?.active(interval, cancel) ?? function releaseConsumer() {
                return undefined;
            };
        },
        async flush() {
            await pending.read();
        }
    };
    return {
        delivery,
        finish(result, policy) {
            finished.write(true);
            const resourceChecks = mergeResourceCheckSnapshots([
                ...result.resourceChecks,
                ...retention.snapshots.values(),
                ...policy?.resourceChecks() ?? []
            ]);
            const failed = resourceChecks.some(function failedChecks(snapshot) {
                return snapshot.failures.length > 0 || snapshot.status.kind === 'incomplete';
            });
            return {
                ...result,
                resourceChecks,
                runnerErrors: [ ...result.runnerErrors, ...errors ],
                status: failed || errors.length > 0 ? 'failed' : result.status
            };
        }
    };
}
export async function withResourceCheckReporting(
    reporter: Pick<ReporterDelivery, 'reportEvent'>,
    policy: TestRuntimePolicy | null,
    plan: TestPlan,
    operation: () => Promise<RunResult>
): Promise<RunResult> {
    const reporting = createResourceCheckReporting(reporter, plan);
    const result = await withResourceCheckDelivery(reporting.delivery, operation);
    await reporting.delivery.flush();
    return reporting.finish(result, policy);
}
