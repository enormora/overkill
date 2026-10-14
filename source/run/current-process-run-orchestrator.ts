import type { Engine } from '../engine/engine.ts';
import {
    createCurrentProcessRunInput,
    type CurrentProcessRunOrchestratorDependencies
} from './current-process-run-input.ts';
import { createNodeRunCoordinator, createNodeRunOrchestrator, type NodeRunCoordinator } from './run-orchestrator.ts';
import type { RunOrchestrator } from './run-orchestrator-types.ts';

export function createCurrentProcessRunOrchestrator(
    defaultEngine: Engine,
    dependencies: CurrentProcessRunOrchestratorDependencies
): RunOrchestrator {
    return createNodeRunOrchestrator(createCurrentProcessRunInput(defaultEngine, dependencies));
}
export function createCurrentProcessRunCoordinator(
    defaultEngine: Engine,
    dependencies: CurrentProcessRunOrchestratorDependencies
): NodeRunCoordinator {
    return createNodeRunCoordinator(createCurrentProcessRunInput(defaultEngine, dependencies));
}
