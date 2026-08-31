import { createCurrentProcessRunOrchestrator } from './current-process-run-orchestrator.ts';
import { defaultRunEngine } from './default-run-engine.ts';

export const orchestrator = createCurrentProcessRunOrchestrator(defaultRunEngine);
