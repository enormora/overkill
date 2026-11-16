# Static Authoring Research

Working proposals from the ESLint concept review. The
[settled catalog](../authoring/higher-test-layers.md#static-authoring-rules)
is normative; candidates here still need decisions. No plugin implementation
is implied by this review.

## Enforcement Boundary

Prefer API shape, types, discovery, or runtime enforcement when those can
establish the constraint. ESLint owns source provenance, binding relationships,
and authoring policies that ordinary execution cannot recover. Runtime source
parsing would still be static analysis, not evidence that execution alone can
enforce a rule.

## Conditional Assertions

Comparing assertion-builder invocations with the collected result catches
discarded assertions. It cannot detect calls on an untaken branch:

```ts
scope.assert.defined(response);

if (response.ok) {
    scope.assert.equal(response.status, 200);
}

return scope.assert.collect();
```

When `response.ok` is false, both counts are one. The existing recorder already
checks that returned assertions include recorded builder assertions in order.
It cannot see the assertion that was never invoked.

An explicit `scope.plan(2)` supplies an independent expected count and detects
this skipped check. Equal counts across repeated runs would not prove the
absence of conditional assertions: two branches can each perform one different
check. Table inputs, shrinking, retries, and selection also make historical
count comparisons unsuitable as an implicit plan.

`no-conditional-assertions` is settled for test bodies only. Custom assertion
implementations may branch. Static detection boundaries, including loops and
family-specific callbacks, still need design. Requiring plans is a separate
authoring policy and does not prove that checks themselves are unconditional.
See the [canonical boundary](../authoring/higher-test-layers.md#conditional-assertions-in-test-bodies).

## Additional ESLint Candidates

| Candidate                       | Benefit and boundary                                                                                                                                                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `no-compound-boolean-assertion` | Split `assert.true(a && b)` into checks with useful diagnostics. Do not blindly rewrite `a \|\| b`, change short-circuit effects, or change plan counts. Could be part of the settled `prefer-semantic-assertions` rule instead.           |
| `no-useless-assertion`          | Reject assertions determined entirely by source constants, including `assert.true(true)`. Complements self-comparison; may fit an expanded `no-constant-actual-assert` instead of a separate rule. Explicit `assert.fail()` remains valid. |

`no-setup-in-error-assertion`, `no-duplicate-assertions`, and `prefer-table`
have moved to the settled catalog. For error callbacks, statement count alone
does not establish intent; sequence expressions and nested argument calls need
careful treatment. Duplicate detection must not assume getters, iterators, or
function calls are stable observations. Tables improve per-case identity,
selection, and failure attribution without forbidding deliberate node composition.

No autofix should change assertion counts, evaluation order, strictness,
short-circuit behavior, or test identity without proving equivalence.

## Runtime Contract Audit

The seven runtime requirements are now settled in their owning concept
documents:

- [Runtime Assertion Integrity](../authoring/assertions-and-results.md#runtime-assertion-integrity):
  durable contract failures, recording lifetime, assertion-time operand meaning,
  returned builder ownership, protocol validation, and nested context ownership.
- [Tests As Values](../authoring/tests-as-values.md#what-it-looks-like):
  discovery rejects additional runtime exports in test entry modules.

Implementation status remains unverified. Source inspection identified these
audit targets; it does not establish that every example currently fails:

- `source/engine/assertion-recorder.ts`: contract signals thrown without a
  durable failure record, missing explicit closed state, inclusion-only checks
  on returned assertions, and repeated recorded node identities.
- `source/engine/assertion-facade.ts` and assertion evaluation: live operand
  references passed to later evaluation, including mutations between checks.
- `source/engine/test-scope-lifecycle.ts` and property trial execution:
  late callbacks, interrupted contexts, wrong active context, and cleanup
  attribution.
- `source/assertion-protocol/evaluation.ts`: structural validation before
  evaluator dispatch and recursive traversal.
- `source/run/run-test-modules.ts`: rejecting additional runtime export names.

Implementation work should reproduce these cases and verify enforcement at
the shared engine/discovery boundaries. Do not add duplicate ESLint rules for
these runtime contracts. Untaken conditional assertions remain an ESLint
concern limited to test bodies; custom assertion implementations may branch.

## Plugin Comparisons

Reviewed these primary rule catalogs as inspiration, not as compatible presets:

- [eslint-node-test](https://github.com/sindresorhus/eslint-node-test#rules):
  error-callback setup, compound assertions, constant checks, adjacent duplicate
  checks, conditional checks, and runtime/API overlap.
- [eslint-plugin-node-assert](https://github.com/enormora/eslint-plugin-node-assert#rules):
  semantic assertions, constant actual operands, constant-outcome checks,
  strictness, and callback signatures.
- [eslint-plugin-mocha](https://github.com/lo1tuma/eslint-plugin-mocha#rules):
  completion protocols, test structure, timeout/retry policies, and titles.
- [eslint-plugin-ava](https://github.com/avajs/eslint-plugin-ava#rules):
  context use, nested assertions, test imports, assertion counts, and conditional
  checks.
- [eslint-plugin-vitest](https://github.com/vitest-dev/eslint-plugin-vitest#rules):
  semantic matcher selection, standalone expectations, snapshot policy, and
  integration with typed linting.
- [eslint-plugin-jest](https://github.com/jest-community/eslint-plugin-jest#rules):
  table authoring, assertion placement, type-based restrictions, and matcher
  policy.

Useful individual references:

- [Setup in error assertion callbacks](https://github.com/sindresorhus/eslint-node-test/blob/main/docs/rules/no-assert-throws-multiple-statements.md)
- [Compound boolean assertions](https://github.com/sindresorhus/eslint-node-test/blob/main/docs/rules/no-compound-assertion.md)
- [Adjacent duplicate assertions](https://github.com/sindresorhus/eslint-node-test/blob/main/docs/rules/no-duplicate-assertions.md)
- [Constant assertion outcomes](https://github.com/enormora/eslint-plugin-node-assert/blob/main/docs/rules/no-useless-assertion.md)
- [Table authoring](https://github.com/jest-community/eslint-plugin-jest/blob/main/docs/rules/prefer-each.md)

Do not copy rules for `.only`/`.skip`, hooks, callback-style completion, matcher
arity, required error matchers, zero assertions, duplicate titles, or assertion
budgets where Overkill's API, types, or runtime already own the constraint.
Jest's restriction on returning from tests conflicts with Overkill's builder
result contract. AVA's restrictions on inline and nested assertions must not
ban valid returned low-level nodes or explicit composite groups.

A blanket ban on importing test files conflicts with tests-as-values suite
composition. Snapshot size limits belong with runtime baseline/artifact policy
when the system already owns the serialized value. Generic async, deprecated
API, unused-code, or import restrictions should reuse existing lint tooling
instead of becoming Overkill-specific copies.

Do not infer that an assertion is useless merely because TypeScript already
declares the operand's type. Tests may intentionally validate an external or
incorrectly typed boundary. A blanket ban on sleeping would also reject tests
of timer behavior; capability and deterministic-clock policy need to distinguish
that from using arbitrary delays as synchronization.
