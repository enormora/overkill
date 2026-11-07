import { createSuite } from '../engine/engine.entry-point.ts';
import { testNode as checker } from './checker.test.ts';
import { testNode as inputs } from './generated-input.test.ts';
import { testNode as mappings } from './generated-mapping.test.ts';
import { testNode as discovery } from './generated-discovery.test.ts';
import { testNode as identity } from './generated-identity.test.ts';
import { testNode as ownership } from './generated-ownership.test.ts';

export const testNode = createSuite({
    title: 'generated checker inputs',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [ checker, inputs, mappings, discovery, identity, ownership ]
});
