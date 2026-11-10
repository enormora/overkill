# @overkill-dev/linearizability

Bounded checking of recorded concurrent histories above Overkill's model layer.
Install separately from `@overkill-dev/test`.

```ts
import { checkLinearizability } from '@overkill-dev/linearizability';

const result = await checkLinearizability({
    history: [
        { kind: 'invoke', id: 'write', operation: 1 },
        { kind: 'respond', id: 'write', outcome: { kind: 'returned', value: undefined } }
    ],
    model: {
        initial: () => 0,
        transition: (_state, observation) => ({ kind: 'enabled', state: observation.operation })
    },
    maxWork: 10000,
    signal: new AbortController().signal
});
```

Events use unique nonblank invocation IDs. Responses follow their invocation at
most once. Array order establishes real-time precedence without clocks. Missing
responses denote pending operations, which may be omitted or linearized through
model-approved effects. Every completed operation must appear in the explanation.

Models receive the operation and a `returned`, `threw`, or `pending` outcome.
Return an existing model `enabled` or `disabled` transition, or
`{ kind: 'alternatives', states: [first, second, ...rest] }`. Callbacks are pure
and synchronous; preserve earlier states and observations across branches.
Containers are shallow snapshots; payload graphs remain author-owned.

Results distinguish `linearizable` with an operation-ID order,
`not-linearizable` after exhaustive rejection, and `inconclusive` with reason
`max-work`. The latter two retain the longest explored valid prefix, with first
encounter winning ties. This prefix is diagnostic, not a minimal counterexample.
Never treat inconclusive as a passing or failing consistency verdict.

`maxWork` is a required positive safe integer. Each candidate inspection,
transition call, and successor exploration costs one unit. Validation and model
callback internals are outside that counter. Search yields every 256 units for
cancellation; synchronous callbacks remain subject to enclosing supervision.
Cancellation propagates the abort reason; malformed input throws `TypeError`;
model exceptions propagate unchanged.

Search is deterministic in invocation and alternative declaration order and
uses no state equality or hashing assumptions. Cost can grow exponentially.
The standalone checker records no operations. The package adds no test family,
CLI, or persistence format. Property owns shrinking, witnesses, corpora, and reporting;
`linearizability(...)` owns concurrent execution.

## Concurrent Operation Authoring

```ts
import { gen, property } from '@overkill-dev/test/property';
import { linearizability } from '@overkill-dev/linearizability';

export const testNode = property({
    title: 'increments are linearizable',
    generator: gen.array(gen.array(gen.integer({ min: 1, max: 3 }))),
    test: linearizability({
        create: () => new Map([ [ 'count', 0 ] ]),
        run(delta: number, counter) {
            const next = (counter.get('count') ?? 0) + delta;
            counter.set('count', next);
            return next;
        },
        model: {
            initial: () => 0,
            transition(state, { operation, outcome }) {
                const next = state + operation;
                return outcome.kind === 'returned' && outcome.value === next
                    ? { kind: 'enabled', state: next }
                    : { kind: 'disabled' };
            }
        },
        maxWork: 10_000
    })
});
```

`linearizability({ create, run, model, maxWork })` returns a
`PropertyBody<LinearizabilityProgram<Operation>>`. Programs are readonly arrays
of readonly operation arrays. Lanes execute concurrently; operations within each
lane execute sequentially. Empty programs and lanes are valid.

`create(sample)` creates a fresh system for each trial and registers teardown
with `sample.cleanup`. `run(operation, system, signal)` returns an output or a
promise. Ordinary throws become recorded outcomes. Cancellation, permission
denials, and engine control errors stop admission, abort the helper signal, and
drain admitted work before propagation. Existing timeout supervision may interrupt
uncooperative work and run cleanup without waiting for it.

Execution and model observations use independently reconstructed operation graphs.
Models are pure; returned output graphs must remain stable after settlement.
Event order, including synchronous returns and throws, determines precedence.
The checker budget is separate from property traversal work.

Linearizable histories pass, exhaustive rejection fails with bounded history and
checker diagnostics, and checker exhaustion calls `sample.inconclusive(reason)`.
This trial-local control requires a nonblank reason. Existing failures take
precedence; inconclusive confirmation or shrinking cannot erase an established
failure or create an unconfirmed witness.

Use ordinary property generators, examples, codecs, corpora, and nested `forall`.
Witnesses preserve lane inputs, not event-loop timing. Replay reruns current code;
property confirmation reports failures that do not reproduce. Property profile
capability and resource restrictions remain unchanged.
