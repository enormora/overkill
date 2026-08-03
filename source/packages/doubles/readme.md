# `@overkill-dev/doubles`

Explicit function-first test doubles for Overkill.

Use this package when a test can inject a function or constructor directly.
It does not patch modules, replace object methods, manage sandboxes, or keep a
restore registry.

## Import

```ts
import {
    doubleUsage,
    rule,
    testAsyncDisposable,
    testAsyncIterable,
    testAsyncIterator,
    testDisposable,
    testDouble,
    testIterable,
    testIterator
} from '@overkill-dev/doubles';
```

Public runtime values:

- `testDouble`: creates callable or constructable test doubles.
- `testIterator`: creates one consumable sync iterator double.
- `testIterable`: creates a reusable sync iterable double.
- `testAsyncIterator`: creates one consumable async iterator double.
- `testAsyncIterable`: creates a reusable async iterable double.
- `testDisposable`: creates a sync disposable double for `using`.
- `testAsyncDisposable`: creates an async disposable double for `await using`.
- `rule`: builds reusable behavior rules.
- `doubleUsage`: assertion references for `case.assert(...)`.

## Create A Double

Untyped doubles are callable and return `undefined`:

```ts
const log = testDouble();

log('saved');
```

Typed doubles keep their function signature:

```ts
type SaveUser = (user: { readonly id: string; readonly name: string; }) => boolean;

const saveUser = testDouble.returns<SaveUser>(true);

saveUser({ id: '42', name: 'Ada' });
```

Constructor doubles keep their constructor signature:

```ts
type ClientConstructor = new (baseUrl: string) => Client;

const client = createClient();
const Client = testDouble.constructs<ClientConstructor>(client);

new Client('https://api.example.test');
```

## Fixed Behavior

- `testDouble()`: creates an untyped function double that returns `undefined`.
- `testDouble.returns(value)`: returns `value` from every call.
- `testDouble.returns<Fn>(value)`: returns `value` and keeps `Fn`.
- `testDouble.returns<Fn>()`: valid for `void` functions.
- `testDouble.resolves(value)`: returns a promise resolved with `value`.
- `testDouble.rejects(reason)`: returns a rejected promise.
- `testDouble.throws(thrown)`: throws `thrown` from every call.
- `testDouble.constructs(instance)`: returns `instance` from `new Double(...)`.
- `testDouble.yields(values, returnValue?)`: returns a fresh tracked sync
  iterator from a finite value array.
- `testDouble.yieldsFrom(factory)`: returns a fresh tracked sync iterator that
  delegates with `yield*`. The factory receives the double call arguments and
  runs lazily on first iterator consumption.
- `testDouble.yieldsAsync(values, returnValue?)`: returns a fresh tracked async
  iterator from a finite value array.
- `testDouble.yieldsAsyncFrom(factory)`: returns a fresh tracked async iterator
  that delegates with async `yield*`. The factory receives the double call
  arguments and may return a sync or async iterable.

## Rules

Rules choose behavior for specific calls or constructions:

```ts
type LoadUser = (id: string) => Promise<User>;

const loadUser = testDouble<LoadUser>({
    rules: [
        rule.when('admin').resolves(adminUser),
        rule.when('guest').resolves(guestUser),
        rule.onCall(2).rejects(new Error('unexpected retry'))
    ],
    fallback: rule.rejects(new Error('unknown user id'))
});
```

Rule starters:

- `rule.when(...args)`: matches a call by a partial-deep argument prefix.
- `rule.whenConstructedWith(...args)`: matches a construction by a partial-deep argument prefix.
- `rule.onCall(index)`: matches the call at zero-based `index`.
- `rule.onConstruction(index)`: matches the construction at zero-based `index`.

Rule terminators:

- `.returns(value)`: returns a value.
- `.resolves(value)`: returns a resolved promise.
- `.rejects(reason)`: returns a rejected promise.
- `.throws(thrown)`: throws a value.
- `.constructs(instance)`: returns an instance from construction rules.
- `.calls(fn)`: calls `fn` for custom behavior.
- `.sequence(entries)`: uses entries in order for repeated matches.
- `.yields(values, returnValue?)`: returns a fresh tracked sync iterator.
- `.yieldsFrom(factory)`: returns a fresh tracked sync iterator delegated from
  the call arguments.
- `.yieldsAsync(values, returnValue?)`: returns a fresh tracked async iterator.
- `.yieldsAsyncFrom(factory)`: returns a fresh tracked async iterator delegated
  from the call arguments.

Behavior factories can also be used directly in `fallback`:

- `rule.returns(value)`
- `rule.resolves(value)`
- `rule.rejects(reason)`
- `rule.throws(thrown)`
- `rule.constructs(instance)`
- `rule.calls(fn)`
- `rule.sequence(entries)`
- `rule.yields(values, returnValue?)`
- `rule.yieldsFrom(factory)`
- `rule.yieldsAsync(values, returnValue?)`
- `rule.yieldsAsyncFrom(factory)`

A fallback can separate call and construction behavior for a value that is both
callable and constructable:

```ts
const Client = testDouble<ClientFactory>({
    fallback: {
        call: rule.returns(clientFromCall),
        construction: rule.constructs(clientFromNew)
    }
});
```

## History

Every double records usage. History properties are non-enumerable.

- `interactionCount`: calls plus constructions.
- `interactions`: all calls and constructions in order for this double.
- `firstInteraction`, `lastInteraction`, `nthInteraction(index)`: selected interaction records.
- `callCount`: normal function calls.
- `calls`: call records in order.
- `firstCall`, `lastCall`, `nthCall(index)`: selected call records.
- `constructionCount`: `new Double(...)` usages.
- `constructions`: construction records in order.
- `firstConstruction`, `lastConstruction`, `nthConstruction(index)`: selected construction records.
- `results`: returned and thrown results in order.
- `firstResult`, `lastResult`: selected result records.
- `iteratorEventCount`: tracked iterator protocol events.
- `iteratorEvents`: tracked `next`, `return`, and `throw` outcomes in order.
- `firstIteratorEvent`, `lastIteratorEvent`, `nthIteratorEvent(index)`:
  selected iterator event records.
- `reset()`: clears this double's public history and rewinds double-owned ordered behavior.

Records include:

- `arguments`: the argument tuple.
- `index`: the zero-based call or construction index for that mode.
- `kind`: `call` or `construction`.
- `order`: the per-double interaction order.
- `result`: returned or thrown result data.
- `thisValue`: only on call records.
- `instance`: only on construction records.

Iterator records are created only for iterators produced by `yields`,
`yieldsFrom`, `yieldsAsync`, and `yieldsAsyncFrom`. They include:

- `kind`: `yield`, `return`, or `throw`.
- `protocol`: `sync` or `async`.
- `method`: `next`, `return`, or `throw`.
- `arguments`: the iterator method arguments.
- `value`: yielded or returned values.
- `thrown`: thrown values.
- `callIndex`, `iteratorIndex`, and `index`: related call and iterator event
  positions.

## Protocol Doubles

Use protocol doubles when the dependency itself is an iterator, iterable, or
disposable object rather than a function that returns one.

```ts
const values = testIterator.yields([ 'created', 'updated' ]);

values.next();

case.assert(doubleUsage.iterated, values);
case.assert(doubleUsage.yieldedExactly, values, [ 'created' ]);
```

`testIterator` creates one consumable well-formed iterator. It works with
`for...of`, exposes platform iterator helpers when the runtime provides them,
and records `next`, `return`, and `throw` through method doubles.

```ts
const source = testIterable.yields([ 'created', 'updated' ]);

[ ...source ];
[ ...source ];

case.assert(doubleUsage.yieldedExactly, source, [
    'created',
    'updated',
    'created',
    'updated'
]);
```

`testIterable` creates a reusable iterable. Each `[Symbol.iterator]()` call
returns a fresh well-formed iterator. Async variants mirror these shapes with
`for await...of`.

Disposable protocol methods are inspectable doubles too:

```ts
const resource = testDisposable({
    dispose: { fallback: rule.throws(new Error('expected')) }
});

using value = resource;

case.assert(doubleUsage.disposedOnce, resource);
case.assert(doubleUsage.calledOnce, resource[Symbol.dispose]);
```

`testAsyncDisposable` exposes `[Symbol.asyncDispose]()` for `await using` and
defaults to resolving `undefined`.

## Assertions

`doubleUsage` contains assertion references for Overkill's engine-owned
assertion context:

```ts
test('saves a user', (case) => {
    const saveUser = testDouble.returns<SaveUser>(true);

    saveUser({ id: '42', name: 'Ada' });

    case.assert(doubleUsage.calledOnceWith, saveUser, [ { id: '42' } ]);

    return case.assert.done();
});
```

Argument assertions always receive one `args` tuple array.

- `*With`: partial-deep matching with exact arity.
- `*WithPrefix`: partial-deep matching on the argument prefix. The tuple must not be empty.
- `*WithExactly`: exact-deep matching with exact arity. These assertions are positive only.

Examples:

```ts
case.assert(doubleUsage.calledWith, saveUser, [ { id: '42' } ]);
case.assert(doubleUsage.calledWithPrefix, writeMetric, [ 'signup' ]);
case.assert(doubleUsage.calledWithExactly, saveUser, [ { id: '42', name: 'Ada' } ]);
case.assert(doubleUsage.calledWith, ping, []);
```

### Counts

- `doubleUsage.interacted(double)`: at least one call or construction.
- `doubleUsage.notInteracted(double)`: no calls or constructions.
- `doubleUsage.interactionCount(double, count)`: exact call plus construction count.
- `doubleUsage.interactedOnce(double)`: exactly one call or construction.
- `doubleUsage.called(double)`: at least one call.
- `doubleUsage.notCalled(double)`: no calls.
- `doubleUsage.callCount(double, count)`: exact call count.
- `doubleUsage.calledOnce(double)`: exactly one call.
- `doubleUsage.constructed(double)`: at least one construction.
- `doubleUsage.notConstructed(double)`: no constructions.
- `doubleUsage.constructionCount(double, count)`: exact construction count.
- `doubleUsage.constructedOnce(double)`: exactly one construction.
- `doubleUsage.disposed(disposable)`: at least one disposal.
- `doubleUsage.notDisposed(disposable)`: no disposal.
- `doubleUsage.disposeCount(disposable, count)`: exact disposal count.
- `doubleUsage.disposedOnce(disposable)`: exactly one disposal.
- `doubleUsage.disposeOrder([a, b, ...])`: disposal order.
- `doubleUsage.iterated(double)`: at least one tracked iterator event.
- `doubleUsage.notIterated(double)`: no tracked iterator events.
- `doubleUsage.iteratorEventCount(double, count)`: exact tracked iterator event
  count.
- `doubleUsage.yieldCount(double, count)`: exact yielded value count.
- `doubleUsage.yieldedExactly(double, values)`: exact yielded values across all
  tracked iterators in event order.

### Any Matching Usage

- `doubleUsage.interactedWith(double, args)`
- `doubleUsage.interactedWithPrefix(double, args)`
- `doubleUsage.interactedWithExactly(double, args)`
- `doubleUsage.calledWith(double, args)`
- `doubleUsage.calledWithPrefix(double, args)`
- `doubleUsage.calledWithExactly(double, args)`
- `doubleUsage.constructedWith(double, args)`
- `doubleUsage.constructedWithPrefix(double, args)`
- `doubleUsage.constructedWithExactly(double, args)`

### Negative Matching Usage

- `doubleUsage.notInteractedWith(double, args)`
- `doubleUsage.notInteractedWithPrefix(double, args)`
- `doubleUsage.notCalledWith(double, args)`
- `doubleUsage.notCalledWithPrefix(double, args)`
- `doubleUsage.notConstructedWith(double, args)`
- `doubleUsage.notConstructedWithPrefix(double, args)`

There are no negative `*WithExactly` assertions. Use `not*With` or
`not*WithPrefix` for negative argument checks.

### Once Matching Usage

These assertions require exactly one relevant event, then check its arguments:

- `doubleUsage.interactedOnceWith(double, args)`
- `doubleUsage.interactedOnceWithPrefix(double, args)`
- `doubleUsage.interactedOnceWithExactly(double, args)`
- `doubleUsage.calledOnceWith(double, args)`
- `doubleUsage.calledOnceWithPrefix(double, args)`
- `doubleUsage.calledOnceWithExactly(double, args)`
- `doubleUsage.constructedOnceWith(double, args)`
- `doubleUsage.constructedOnceWithPrefix(double, args)`
- `doubleUsage.constructedOnceWithExactly(double, args)`

### Last Matching Usage

- `doubleUsage.lastInteractedWith(double, args)`
- `doubleUsage.lastInteractedWithPrefix(double, args)`
- `doubleUsage.lastInteractedWithExactly(double, args)`
- `doubleUsage.lastCalledWith(double, args)`
- `doubleUsage.lastCalledWithPrefix(double, args)`
- `doubleUsage.lastCalledWithExactly(double, args)`
- `doubleUsage.lastConstructedWith(double, args)`
- `doubleUsage.lastConstructedWithPrefix(double, args)`
- `doubleUsage.lastConstructedWithExactly(double, args)`

### Indexed Matching Usage

Indexes are zero-based:

- `doubleUsage.nthInteractionWith(double, index, args)`
- `doubleUsage.nthInteractionWithPrefix(double, index, args)`
- `doubleUsage.nthInteractionWithExactly(double, index, args)`
- `doubleUsage.nthCallWith(double, index, args)`
- `doubleUsage.nthCallWithPrefix(double, index, args)`
- `doubleUsage.nthCallWithExactly(double, index, args)`
- `doubleUsage.nthConstructionWith(double, index, args)`
- `doubleUsage.nthConstructionWithPrefix(double, index, args)`
- `doubleUsage.nthConstructionWithExactly(double, index, args)`

### Order

Order assertions compare usage across doubles:

```ts
case.assert(doubleUsage.callOrder, [ loadUser, saveUser, publishEvent ]);
```

- `doubleUsage.interactionOrder([first, second, ...])`
- `doubleUsage.callOrder([first, second, ...])`
- `doubleUsage.constructionOrder([first, second, ...])`

The list must contain at least two doubles. Each double must have at least one
relevant event. For each adjacent pair, all relevant events on the previous
double must happen before any relevant event on the next double.

Order is tracked inside the doubles package. Resetting a double clears its
public history, but it does not reset the hidden chronology used for
cross-double order assertions.

## Types

Exported types:

- `TestDouble<Signature>`: a function or constructor with history attached.
- `TestDoubleFactory`: the `testDouble` factory shape.
- `DoubleHistory<Signature>`: the introspection API attached to each double.
- `DoubleInvocation<Arguments>`: invocation data passed to answer callbacks.
- `DoubleCall<Arguments, ReturnValue, ThisValue>`: a recorded function call.
- `DoubleConstruction<Arguments, Instance>`: a recorded construction.
- `DoubleInteraction`: a call or construction record.
- `DoubleResult<Value>`: a returned or thrown result.
- `DoubleReturnedResult<Value>`: a returned result.
- `DoubleThrownResult`: a thrown result.
- `RuleFactory`: the `rule` namespace shape.
- `DoubleUsageAssertions`: the `doubleUsage` namespace shape.
