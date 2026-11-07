# `@overkill-dev/model`

Install separately with `npm install -D @overkill-dev/model`. Model tests use
`testFamily: 'property'` profiles and their normal budgets and supervision.
They cannot attach resources or access capabilities forbidden to properties.

```ts
import { model } from '@overkill-dev/model';
import { gen } from '@overkill-dev/property';

export const testNode = model({
    title: 'counter matches its model',
    settings: {},
    initial: () => 0,
    commands: () => gen.integer({ min: 1, max: 5 }),
    transition: (state, operation) => ({ kind: 'enabled', state: state + operation }),
    length: { minLength: 1, maxLength: 20 },
    codec: null,
    examples: [],
    coverage: [],
    create: () => ({ value: 0 }),
    run(operation, system) {
        system.value += operation;
    },
    check(state, system, sample) {
        sample.assert.equal(system.value, state);
    }
});
```

`initial`, `commands`, and `transition` are pure, synchronous, deterministic
callbacks. Initial state must be fresh. Transitions return a new expected state
without mutating their state or operation. Disabled transitions return
`{ kind: 'disabled' }`; generation rejects them rather than skipping commands.
Return `null` from `commands` for a terminal state. Short terminal traces must
still satisfy `minLength`. Property `maxSize` caps generated trace length.

Each evaluation reconstructs separate operation graphs for prediction and system
execution. Aliases and cycles remain intact within each graph. System mutation
cannot change expected model state or retained witnesses. This relies on the
property reconstruction contract: factories cannot return shared mutable data.
Supply a versioned codec for the complete trace when operations use custom types.

`create`, `run`, and `check` may be asynchronous. Checks run initially and after
each operation. Register disposal through `sample.cleanup`; cleanup finishes
before another trial starts. Assertions retain ordinary `assert` and `require`
semantics, including zero-assertion detection. One model is one property case.

`modelScenario(definition)` omits `title` and `settings` and returns a property
invocation. Pass it to `scope.forall` inside `withProperties`, or spread it into
`property`. Preview its generator with `sampleGenerator`.

Shrinking, failure confirmation, witnesses, corpus promotion, and replay use
existing property APIs and commands. Stored traces replay without command
generation and independently of current generation length limits. Every stored
transition must remain enabled; incompatible traces fail before system creation.
