import { isDeepStrictEqual } from 'node:util';
import type { FamilyRunFacts } from '../engine/family-run.ts';
import { currentReplay } from './replay-context.ts';
import { invalidRequest } from './run-errors.ts';

export function validateRecordedFamilyFacts(facts: FamilyRunFacts): void {
    const replay = currentReplay();
    if (replay?.kind !== 'record' || replay.record.facts.family === null) {
        return;
    }
    if (!isDeepStrictEqual(replay.record.facts.family, facts)) {
        invalidRequest('Recorded family inputs or implementation changed; collect a new run.');
    }
}
