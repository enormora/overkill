import { isDeepStrictEqual } from 'node:util';
import { catalogFromDeclarations } from '../engine/body-reference-plan.ts';
import type { ImplementationCatalog } from '../implementation-catalog.ts';
import { currentReplay } from './replay-context.ts';
import type { CollectedRunCaseEntry } from './collected-run-plan.ts';

export function collectImplementationCatalog(
    entries: readonly CollectedRunCaseEntry[],
    projectRoot: string
): ImplementationCatalog | null {
    const implementations = catalogFromDeclarations(
        entries.map(function declaration(entry) {
            return entry.testCase.implementationDeclaration;
        }),
        projectRoot
    );
    const replay = currentReplay();
    if (replay?.kind === 'record' && !isDeepStrictEqual(implementations, replay.record.facts.implementations)) {
        throw new TypeError('Recorded implementation provenance changed; collect a new run.');
    }
    return implementations;
}
