import type { TestScope } from '../../packages/test/test.entry-point.ts';
import type { RunResult } from '../../packages/engine/engine.entry-point.ts';
import { processEvidenceSchema } from '../../bench/process-evidence.ts';
import { processEvidenceForWork } from '../../bench/process-evidence-query.ts';
import type { ProcessExecution } from '../../bench/process-protocol.ts';
import { createBenchmarkHtmlReport } from '../../reporters/benchmark-html-model.ts';

function executions(result: RunResult, title: string): readonly ProcessExecution[] {
    const tested = result.perTest.find(function matchingCase(entry) {
        return entry.id.title === title;
    });
    if (tested === undefined) {
        throw new Error('Expected an external-process benchmark result.');
    }
    return processEvidenceForWork(result, tested.workId).flatMap(function capturedProcesses(artifact) {
        if (artifact.payload.kind !== 'runtime-attachment' || artifact.payload.content.kind !== 'json') {
            throw new Error('Expected recorded process evidence.');
        }
        const evidence = processEvidenceSchema.parse(artifact.payload.content.value);
        return evidence.entries.map(function execution(entry) {
            return entry.execution;
        });
    });
}

function assertPipeEvidence(scope: TestScope, result: RunResult): void {
    const children = executions(result, 'pipe child probe');
    const childIdentities = children.map(function childIdentity(execution) {
        if (execution.status !== 'measured' || execution.result.value.output.kind !== 'pipes') {
            throw new Error('Expected measured pipe output.');
        }
        const { metrics } = execution.result;
        scope.assert.equal(execution.result.value.output.stderr.text, 'diagnostic');
        scope.assert.equal(execution.result.value.metadata.instrumentation, 'node');
        scope.assert.equal(metrics.processCpuTotalMicroseconds.availability, 'available');
        return execution.result.value.output.stdout.text;
    });
    scope.assert.equal(children.length, 3);
    const distinct = new Set(childIdentities);
    scope.assert.equal(distinct.size, 3);
}

function assertTerminalEvidence(scope: TestScope, result: RunResult): void {
    const children = executions(result, 'terminal interaction');
    scope.assert.equal(children.length, 3);
    for (const execution of children) {
        if (execution.status !== 'measured' || execution.result.value.output.kind !== 'terminal') {
            throw new Error('Expected measured terminal output.');
        }
        scope.assert.includes(execution.result.value.output.terminal.text, 'Ready true 80 24');
        scope.assert.includes(execution.result.value.output.terminal.text, 'Reply 100 30');
        scope.assert.equal(
            execution.result.metrics['interaction.reply.durationMicroseconds']?.availability,
            'available'
        );
        scope.assert.equal(execution.result.value.completion.kind, 'interaction');
    }
}

export function assertCompletedBenchmarks(scope: TestScope, result: RunResult): void {
    scope.assert.deepEqual(result.runnerErrors, []);
    scope.assert.equal(result.summary.passed, 2);
    assertPipeEvidence(scope, result);
    assertTerminalEvidence(scope, result);
    for (const tested of result.perTest) {
        scope.assert.equal(tested.benchmark?.normalization, null);
    }
    const html = createBenchmarkHtmlReport(result);
    scope.assert.includes(JSON.stringify(html.cases), 'node-child-cpu-v1');
    scope.assert.includes(JSON.stringify(html.cases), 'instrumentation');
}
