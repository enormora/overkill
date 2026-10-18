import type { CollectedRunPlan, WorkId } from '../packages/run/run.entry-point.ts';

const definitionLocations = [ { kind: 'unknown' } ] as const;
const annotations = { ownership: [], tags: [] };
const controls = { capture: null, duplicateExecution: null, timeoutMilliseconds: null };

export function collectedMutationPlan(works: readonly WorkId[]): CollectedRunPlan {
    const files = Array.from(
        Map.groupBy(works, function caseFile(entry) {
            return entry.case.file ?? '';
        }),
        function collectedFile([ file, entries ]) {
            return {
                file,
                cases: entries.map(function collectedCase(entry) {
                    return {
                        annotations,
                        controls,
                        definitionLocations,
                        params: entry.case.params,
                        property: null,
                        benchmark: null,
                        workloadParameters: null,
                        resourceAttachments: { directResources: [], resourceGraph: [], runtimeGraphs: [] },
                        skipReason: null,
                        suitePath: entry.case.suite.map(function suiteEntry(title) {
                            return { title, definitionLocations };
                        }),
                        testFamily: 'microtest' as const,
                        title: entry.case.title,
                        workId: entry
                    };
                })
            };
        }
    );
    return {
        defined: works.length,
        discoveredFiles: files,
        files,
        orphans: [],
        root: {
            annotations,
            controls,
            title: 'catalog'
        }
    };
}
