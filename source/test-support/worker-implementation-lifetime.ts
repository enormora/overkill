import {
    createWorkerImplementationLifetime,
    type WorkerImplementationLifetime
} from '../run/worker-implementation-lifetime.ts';
import type { TestPlan } from '../engine/test-plan.ts';
import { createTestEngine } from './create-test-engine.ts';
import { referencedTestBody } from './referenced-test-body.ts';

export type LeaseFaults = { readonly start: Error | null; readonly close: Error | null; };
export const healthyImplementationLease: LeaseFaults = { start: null, close: null };
type ImplementationLifetimeFixture = {
    readonly lifetime: WorkerImplementationLifetime;
    readonly plan: TestPlan;
    readonly inline: TestPlan;
    readonly events: readonly string[];
};
export function workerImplementationLifetime(faults: LeaseFaults): ImplementationLifetimeFixture {
    const engine = createTestEngine();
    const body = referencedTestBody();
    const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
    const plan = engine.createTestPlan(
        engine.createRoot({
            title: 'references',
            annotations: {},
            controls: {},
            children: [ engine.createTestCase({ ...metadata, title: 'referenced', body: body.body }) ]
        })
    );
    const inline = engine.createTestPlan(
        engine.createRoot({
            title: 'inline',
            annotations: {},
            controls: {},
            children: [ engine.createTestCase({
                ...metadata,
                title: 'inline',
                body() {
                    throw new Error('Lifetime tests must not execute the case.');
                }
            }) ]
        })
    );
    const events: string[] = [];
    let sequence = 0;
    const lifetime = createWorkerImplementationLifetime(async function (selected, signal) {
        signal.throwIfAborted();
        if (faults.start !== null) {
            throw faults.start;
        }
        sequence += 1;
        const identity = sequence;
        events.push(`start:${identity}`);
        return {
            plan: selected,
            async run(operation) {
                events.push(`enter:${identity}`);
                try {
                    return await operation();
                } finally {
                    events.push(`leave:${identity}`);
                }
            },
            async close() {
                events.push(`close:${identity}`);
                if (faults.close !== null) {
                    throw faults.close;
                }
            }
        };
    });
    return { lifetime, plan, inline, events };
}

export async function aggregateLeaseFailure(operation: () => Promise<unknown>): Promise<AggregateError> {
    try {
        await operation();
    } catch (error: unknown) {
        if (error instanceof AggregateError) {
            return error;
        }
        throw error;
    }
    throw new Error('Expected aggregate lease failure.');
}
