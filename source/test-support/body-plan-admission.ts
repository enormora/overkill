import { createModuleLoading } from '../module-delivery.ts';
import { assertImplementationGraph, deliverImplementationGraph } from '../implementation-graph.ts';
import { createPreparedAssignmentSession, admitImplementationAssignments } from '../implementation-assignment.ts';
import { restorePreparedImplementationBuild } from '../implementation-build-preparation.ts';
import {
    declareImplementationPlan,
    prepareBodyReferences,
    type BodyPlanAdmissionRuntime
} from '../engine/body-reference-plan.ts';
import type { TestPlan } from '../engine/test-plan.ts';
import * as bodyImplementation from './body-plan-implementation.ts';
import { bodyReferencePlan } from './body-reference-plan.ts';
import { memoryImplementationGraph, memoryImplementationModule } from './memory-implementation-graph.ts';
import { moduleLoadingRuntime } from './module-loading-runtime.ts';

type BodyPlanAdmission = {
    readonly plan: TestPlan;
    readonly runtime: BodyPlanAdmissionRuntime;
    readonly events: readonly string[];
};
export async function bodyPlanAdmission(): Promise<BodyPlanAdmission> {
    const platform = moduleLoadingRuntime();
    const events: string[] = [];
    const sources = memoryImplementationGraph([ memoryImplementationModule('file:///project/body.mjs', {}) ]);
    const preparation = createPreparedAssignmentSession(sources.preparation);
    const declared = await declareImplementationPlan(
        bodyReferencePlan(true),
        { projectRoot: '/project' },
        AbortSignal.any([]),
        async function () {
            return preparation;
        }
    );
    const plan = await prepareBodyReferences(declared, { projectRoot: '/project' }, AbortSignal.any([]));
    const loading = createModuleLoading({
        ...platform.runtime,
        async load(url) {
            await platform.runtime.load(url);
            return { namespace: bodyImplementation };
        }
    });
    return {
        plan,
        events,
        runtime: {
            async restore(build, signal) {
                events.push('restore');
                return await restorePreparedImplementationBuild(build, signal, sources.preparation.prepare);
            },
            async admit(request, execute) {
                return await admitImplementationAssignments(request, execute, async function () {
                    return {
                        async verifyImplementationGraph(graph, facts) {
                            events.push('verify');
                            assertImplementationGraph(graph, await sources.preparation.prepare(facts));
                        },
                        async withImplementationGraph(graph, operation) {
                            return await deliverImplementationGraph(graph, operation, loading.withModuleDelivery);
                        }
                    };
                });
            }
        }
    };
}
