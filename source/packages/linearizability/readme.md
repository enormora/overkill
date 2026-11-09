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
This package records no operations and adds no test family, CLI, persistence, or
assertion adapter. Property owns shrinking, witnesses, corpora, and reporting;
the subsequent `linearizability(...)` helper will own concurrent execution.
