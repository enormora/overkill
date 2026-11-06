import { isDeepStrictEqual } from 'node:util';
import { workIdentityKey, caseIdentityKey, runtimeIdentitiesKey } from '../engine/identity.ts';
import type { TestPlan, TestPlanCase, TestPlanCaseExecution } from '../engine/test-plan.ts';
import { collectedRunCaseEntries, type CollectedRunCaseEntry } from './collected-run-plan.ts';
import type { CollectedRunPlan } from './run-types.ts';
import { RunCollectionError } from './run-errors.ts';
import { unavailableRuntimeCase } from './replay-unavailable-runtime.ts';

type CaseCandidates = ReadonlyMap<string, readonly TestPlanCase[]>;
function bindingError(message: string): never {
    throw new RunCollectionError(message, { cause: null }, 'loader');
}
function restoredExecution(current: TestPlanCaseExecution, saved: CollectedRunCaseEntry): TestPlanCaseExecution {
    const metadata = saved.testCase;
    if (metadata.skipReason !== null) {
        return { kind: 'skip', reason: metadata.skipReason };
    }
    if (current.kind === 'skip') {
        bindingError(`Recorded executable case no longer has a body: ${saved.id.title}`);
    }
    if (current.bodyMode === 'property' && metadata.property !== null) {
        return { ...current, policy: { kind: 'resolved', policy: metadata.property.policy } };
    }
    return current;
}
function bindCase(current: TestPlanCase, saved: CollectedRunCaseEntry): TestPlanCase {
    const metadata = saved.testCase;
    if (current.testFamily !== metadata.testFamily) {
        bindingError(`Recorded case family changed: ${saved.id.title}`);
    }
    if (!isDeepStrictEqual(current.resourceAttachments, metadata.resourceAttachments)) {
        bindingError(`Recorded resource or runtime descriptors changed: ${saved.id.title}`);
    }
    return {
        ...current,
        execution: restoredExecution(current.execution, saved),
        id: saved.id,
        workId: saved.workId,
        annotations: metadata.annotations,
        controls: metadata.controls,
        workloadParameters: metadata.workloadParameters
    };
}
function unavailableRecordedCase(current: TestPlan, saved: CollectedRunCaseEntry): TestPlanCase {
    const logicalCase = current.discoveredCases.find(function sameCase(candidate) {
        return caseIdentityKey(candidate.id) === caseIdentityKey(saved.id);
    });
    if (logicalCase === undefined) {
        bindingError(`Recorded case is unavailable: ${JSON.stringify(saved.id)}`);
    }
    if (logicalCase.testFamily !== saved.testCase.testFamily) {
        bindingError('Recorded case family changed.');
    }
    const runtimeExists = current.discoveredCases.some(function sameRuntime(candidate) {
        return caseIdentityKey(candidate.id) === caseIdentityKey(saved.id) &&
            runtimeIdentitiesKey(candidate.workId.runtimes) === runtimeIdentitiesKey(saved.workId.runtimes);
    });
    if (runtimeExists || saved.workId.runtimes.length === 0) {
        bindingError('Recorded workload variant is unavailable.');
    }
    return unavailableRuntimeCase(logicalCase, saved);
}

function selectRecordedCase(current: TestPlan, candidates: CaseCandidates, saved: CollectedRunCaseEntry): TestPlanCase {
    const matches = candidates.get(workIdentityKey(saved.workId)) ?? [];
    const [ selected ] = matches;
    if (selected !== undefined) {
        if (matches.length !== 1) {
            bindingError(`Recorded case is ambiguous: ${JSON.stringify(saved.workId)}`);
        }
        return bindCase(selected, saved);
    }
    return unavailableRecordedCase(current, saved);
}

function indexCases(current: TestPlan): CaseCandidates {
    const candidates = new Map<string, TestPlanCase[]>();
    for (const testCase of current.discoveredCases) {
        const key = workIdentityKey(testCase.workId);
        const entries = candidates.get(key) ?? [];
        entries.push(testCase);
        candidates.set(key, entries);
    }
    return candidates;
}
function restoredDiscovery(template: TestPlanCase, saved: CollectedRunPlan): TestPlan['discoveredCases'] {
    const discovered = collectedRunCaseEntries({ ...saved, files: saved.discoveredFiles }).map(
        function metadata(entry) {
            return {
                ...template,
                id: entry.id,
                workId: entry.workId,
                annotations: entry.testCase.annotations,
                controls: entry.testCase.controls,
                definitionLocations: entry.testCase.definitionLocations,
                suitePath: entry.testCase.suitePath
            };
        }
    );
    const [ first, ...rest ] = discovered;
    return first === undefined ? [ template ] : [ first, ...rest ];
}
export function bindRecordedTestPlan(current: TestPlan, saved: CollectedRunPlan): TestPlan {
    const candidates = indexCases(current);
    const cases = collectedRunCaseEntries(saved).map(function bind(entry) {
        return selectRecordedCase(current, candidates, entry);
    });
    const [ first = current.cases[0], ...rest ] = cases;
    return {
        ...current,
        defined: saved.defined,
        cases: [ first, ...rest ],
        orphans: saved.orphans,
        discoveredCases: restoredDiscovery(first, saved),
        root: { ...current.root, ...saved.root }
    };
}
