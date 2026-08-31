import type { Engine } from '../engine/engine.ts';
import {
    createCommandLineRunner,
    loadDefaultLineReporter,
    type CommandLineRunner
} from './command-line-runner.ts';
import { createCurrentProcessRunOrchestrator } from './current-process-run-orchestrator.ts';
import {
    loadRunConfig
} from './run-config.ts';
import {
    loadUnimplementedBaselineCommands,
    loadUnimplementedBenchmarkCommands
} from './command-line-unimplemented-commands.ts';

export type NodeCommandLineRunnerOptions = {
    readonly defaultEngine: Engine;
};

export function createNodeCommandLineRunner(options: NodeCommandLineRunnerOptions): CommandLineRunner {
    return createCommandLineRunner({
        createDefaultReporter: loadDefaultLineReporter,
        loadBaselineCommands: loadUnimplementedBaselineCommands,
        loadBenchmarkCommands: loadUnimplementedBenchmarkCommands,
        loadRunConfig,
        orchestrator: createCurrentProcessRunOrchestrator(options.defaultEngine)
    });
}
