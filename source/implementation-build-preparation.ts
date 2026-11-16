import { isDeepStrictEqual } from 'node:util';
import { withRunnerInfrastructure } from './execution-ownership.ts';
import { implementationBuildIdentity, type ImplementationBuild } from './implementation-catalog.ts';
import type { PreparedImplementationAssignments } from './implementation-assignment.ts';

export async function restoreImplementationBuild(
    build: ImplementationBuild,
    signal: AbortSignal
): Promise<PreparedImplementationAssignments> {
    signal.throwIfAborted();
    const graph = await withRunnerInfrastructure(async function restore() {
        const { prepareImplementationGraph } = await import('./implementation-graph.ts');
        return await prepareImplementationGraph(build.assignments.map(function facts(assignment) {
            return assignment.facts;
        }));
    });
    const prepared = { assignments: build.assignments, graph };
    signal.throwIfAborted();
    if (!isDeepStrictEqual(implementationBuildIdentity(prepared), build)) {
        throw new TypeError('Implementation build changed; prepare and collect a new run.');
    }
    return prepared;
}
