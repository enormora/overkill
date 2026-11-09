# @overkill-dev/differential

Differential comparisons above Overkill's property core.

Install alongside `@overkill-dev/test`, then use a property profile:

```ts
import { gen, property } from '@overkill-dev/test/property';
import { differential } from '@overkill-dev/differential';

export const testNode = property({
    title: 'implementations agree',
    generator: gen.integer({ min: 0, max: 100 }),
    test: differential({
        implementations: [
            { name: 'multiply', run: (value) => value * 2 },
            { name: 'add', run: (value) => value + value }
        ],
        check(observations, sample) {
            sample.assert.deepEqual(observations[0].outcome, observations[1].outcome);
            return sample.assert.collect();
        }
    })
});
```

`differential({ implementations, check })` returns a property body, also usable
with nested `scope.forall`. Supply at least two implementations with unique
nonblank names. Each receives an independently reconstructed input and an abort
signal. Execution follows declaration order, awaiting each implementation.

Outcomes distinguish `{ kind: 'returned', value }` from `{ kind: 'threw', error }`.
The required check receives ordered observations containing name, actual input
after execution, and outcome, plus the property assertion scope. Define expected
error equivalence explicitly. Permission denials, engine control signals,
reconstruction failures, and cancellation retain normal execution semantics.

Property owns settings, examples, coverage, shrinking, confirmation, codecs,
corpora, witnesses, cleanup, and supervision. One differential property is one
case and one boundary assertion. Replay reruns current implementations on stored
inputs. Shared external state remains the author's responsibility. Use
`sample.failureKey(...)` for comparisons needing a stable semantic failure key.
