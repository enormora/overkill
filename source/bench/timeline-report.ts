import type { BenchmarkTimelineReport } from '../engine/benchmark-timeline.ts';
import type { RunResult, PerTestResult, RunArtifact } from '../engine/run-result.ts';
import { workIdentityKey } from '../engine/identity.ts';
import { canonicalIdentityJson } from '../canonical-identity.ts';
import { benchmarkTimelineReportSchema } from './timeline-schema.ts';

export const benchmarkTimelineMediaType = 'application/vnd.overkill.benchmark-timeline+json';
function assertOwner(artifact: RunArtifact, test: PerTestResult): void {
    if (artifact.id.scope.kind !== 'case' || artifact.id.attempt?.index !== test.attempts.at(-1)?.attempt.index) {
        throw new Error('Timeline artifact belongs to another workload, runtime, case, or attempt.');
    }
    const work = { case: artifact.id.scope.case, runtimes: artifact.id.runtimes, workload: artifact.id.workload };
    if (workIdentityKey(work) !== workIdentityKey(test.workId)) {
        throw new Error('Timeline artifact belongs to another workload, runtime, case, or attempt.');
    }
}

function timelineContent(artifact: RunArtifact): BenchmarkTimelineReport | null {
    const { payload } = artifact;
    if (payload.kind !== 'runtime-attachment' || payload.mediaType !== benchmarkTimelineMediaType) {
        return null;
    }
    return payload.content.kind === 'json' ? benchmarkTimelineReportSchema.parse(payload.content.value) : null;
}

export function readBenchmarkTimeline(result: RunResult, test: PerTestResult): BenchmarkTimelineReport | null {
    const reference = test.benchmark?.timeline?.reference ?? null;
    if (reference === null) {
        return null;
    }
    const key = canonicalIdentityJson(JSON.parse(reference));
    const artifact = result.artifacts.find(function matchingReference(candidate) {
        return canonicalIdentityJson(candidate.id) === key;
    });
    if (artifact === undefined) {
        return null;
    }
    assertOwner(artifact, test);
    return timelineContent(artifact);
}
