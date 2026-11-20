import { suite as authoredSuite } from '@overkill-dev/test';

import { testNode as graph } from './property-graph.test.ts';
import { testNode as inconclusive } from './property-inconclusive.test.ts';
import { testNode as reconstruction } from './property-input-reconstruction.test.ts';
import { testNode as previews } from './generator-preview.test.ts';
import { testNode as relations } from './relation.test.ts';

import { testNode as authoring } from './property-authoring.test.ts';

export const testNode = authoredSuite('property authoring tools', [
    graph,
    inconclusive,
    authoring,
    previews,
    relations,
    reconstruction
]);
