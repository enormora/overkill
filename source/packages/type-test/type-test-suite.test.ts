import { createSuite } from '../engine/engine.entry-point.ts';
import { testNode as ownershipPolicy } from './source-ownership-policy.test.ts';
import { testNode as nativeSyntax } from './native-ast-policy.test.ts';
import { testNode as nativeResultPolicy } from './native-result-policy.test.ts';
import { testNode as origins } from './body-origin.test.ts';
import { testNode as assertions } from './assertion-reference.test.ts';

export const testNode = createSuite({
    title: 'type-test adapter',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [
        ownershipPolicy,
        nativeSyntax,
        origins,
        assertions,
        nativeResultPolicy
    ]
});
