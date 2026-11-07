import { suite } from '../packages/test/test.entry-point.ts';
import { testNode as reconstruction } from './property-input-reconstruction.test.ts';
import { testNode as previews } from './generator-preview.test.ts';
import { testNode as relations } from './relation.test.ts';

import { testNode as authoring } from './property-authoring.test.ts';

export const testNode = suite('property authoring tools', [ authoring, previews, relations, reconstruction ]);
