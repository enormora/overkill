import { suite } from '../packages/test/test.entry-point.ts';
import { testNode as commands } from './baseline-commands.test.ts';
import { testNode as evaluation } from './baseline-evaluation.test.ts';
import { testNode as inventory } from './baseline-inventory.test.ts';
import { testNode as outcomes } from './baseline-outcomes.test.ts';
import { testNode as storage } from './baseline-storage.test.ts';
import { testNode as workflow } from './baseline-workflow.test.ts';
import { testNode as publication } from './baseline-publication.test.ts';
import { testNode as failures } from './baseline-failure-boundaries.test.ts';
import { testNode as snapshots } from './snapshot.test.ts';

export const testNode = suite('ordinary baseline execution', [
    commands,
    evaluation,
    inventory,
    outcomes,
    storage,
    workflow,
    publication,
    failures,
    snapshots
]);
