import { createRunCoordinator, type RunCoordinator } from './run-coordinator.entry-point.ts';
import {
    createNodeRunOrchestratorDependencies,
    type NodeRunOrchestratorInput
} from './node-run-orchestrator-dependencies.entry-point.ts';
import type { RunOrchestrator } from './run-orchestrator-types.ts';

export type NodeRunCoordinator = {
    readonly orchestrator: RunOrchestrator;
    readonly runDirectEntrypoint: RunCoordinator['runDirectEntrypoint'];
};
export function createNodeRunCoordinator(input: NodeRunOrchestratorInput): NodeRunCoordinator {
    return createRunCoordinator(createNodeRunOrchestratorDependencies(input));
}
export function createNodeRunOrchestrator(input: NodeRunOrchestratorInput): RunOrchestrator {
    return createNodeRunCoordinator(input).orchestrator;
}
