import type { CompositeAssertionReturn } from '@overkill-dev/test/assert';
import type { CompositeCheckBuilder } from '@overkill-dev/test/assert';
import { defineCompositeAssertion } from '@overkill-dev/test/assert';

import type { RunResult } from '../../../packages/engine/engine.entry-point.ts';
import { processEvidenceSchema } from '../../../bench/process-evidence.ts';
import { processEvidenceForWork } from '../../../bench/process-evidence-query.ts';
import type { ProcessExecution } from '../../../bench/process-protocol.ts';
import { createBenchmarkHtmlReport } from '../../../reporters/benchmark-html-model.ts';

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

const pipeEvidenceChecks = (
    check: CompositeCheckBuilder<'assert'>,
    result: RunResult
): CompositeAssertionReturn<'assert'> => {
    const children = executions(result, 'pipe child probe');
    const observations = children.map(function measuredPipe(execution) {
        if (execution.status !== 'measured' || execution.result.value.output.kind !== 'pipes') {
            throw new Error('Expected measured pipe output.');
        }
        return {
            identity: execution.result.value.output.stdout.text,
            checks: check.group([
                check.equal(execution.result.value.output.stderr.text, 'diagnostic'),
                check.equal(execution.result.value.metadata.instrumentation, 'node'),
                check.equal(execution.result.metrics.processCpuTotalMicroseconds.availability, 'available')
            ])
        };
    });
    return check.group([
        check.equal(children.length, 3),
        check.equal(
            new Set(observations.map(function processIdentity(entry) {
                return entry.identity;
            }))
                .size,
            3
        ),
        ...observations.map(function retainedChecks(entry) {
            return entry.checks;
        })
    ]);
};
const terminalEvidenceChecks = (
    check: CompositeCheckBuilder<'assert'>,
    result: RunResult
): CompositeAssertionReturn<'assert'> => {
    const children = executions(result, 'terminal interaction');
    return check.group([
        check.equal(children.length, 3),
        ...children.map((execution) => {
            if (execution.status !== 'measured' || execution.result.value.output.kind !== 'terminal') {
                throw new Error('Expected measured terminal output.');
            }
            return check.group([
                check.includes(execution.result.value.output.terminal.text, 'Ready true 80 24'),
                check.includes(execution.result.value.output.terminal.text, 'Reply 100 30'),
                check.equal(
                    execution.result.metrics['interaction.reply.durationMicroseconds']?.availability,
                    'available'
                ),
                check.equal(execution.result.value.completion.kind, 'interaction')
            ]);
        })
    ]);
};

export const assertCompletedBenchmarks = defineCompositeAssertion({
    name: 'completed process benchmarks',
    assert(check, result: RunResult) {
        const html = createBenchmarkHtmlReport({ result, context: { id: null, startedAt: null, facts: null } });
        return check.group([
            check.deepEqual(result.runnerErrors, []),
            check.equal(result.summary.passed, 2),
            pipeEvidenceChecks(check, result),
            terminalEvidenceChecks(check, result),
            ...result.perTest.map(function unnormalizedBenchmark(tested) {
                return check.equal(tested.benchmark?.normalization, null);
            }),
            check.includes(JSON.stringify(html.cases), 'node-child-cpu-v1'),
            check.includes(JSON.stringify(html.cases), 'instrumentation')
        ]);
    }
});
