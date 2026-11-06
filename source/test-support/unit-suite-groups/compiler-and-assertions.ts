import { createSuite } from '../../packages/engine/engine.entry-point.ts';
import { testNode as checker } from '../../packages/type-test/checker.test.ts';
import { testNode as generatedInputs } from '../../packages/type-test/generated-input.test.ts';
import { testNode as mappings } from '../../packages/type-test/generated-mapping.test.ts';
import { testNode as discovery } from '../../packages/type-test/generated-discovery.test.ts';
import { testNode as identity } from '../../packages/type-test/generated-identity.test.ts';
import { testNode as ownership } from '../../packages/type-test/generated-ownership.test.ts';
import { testNode as assertions } from './assert-and-run.ts';

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'assertions and compiler adapters',
    annotations: {},
    controls: {},
    children: [ checker, assertions, generatedInputs, mappings, discovery, identity, ownership ]
});
