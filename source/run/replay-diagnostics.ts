import type { ReplayExecution } from './replay-context.ts';

const interruptedReplayDiagnostic = [
    'Replay uses an interrupted trace prefix.',
    'Remaining unassigned work follows saved lane order without new adaptive decisions.'
]
    .join(' ');
export function replayDiagnostics(replay: ReplayExecution): readonly string[] {
    if (replay.kind !== 'record') {
        return [];
    }
    const diagnostics: string[] = [];
    if (replay.record.versions.node.split('.', 1)[0] !== process.versions.node.split('.', 1)[0]) {
        diagnostics.push(`Replay Node major differs from recorded Node ${replay.record.versions.node}.`);
    }
    if (replay.record.status !== 'completed') {
        diagnostics.push(interruptedReplayDiagnostic);
    }
    return diagnostics;
}
