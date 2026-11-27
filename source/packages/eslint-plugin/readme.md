# Overkill ESLint plugin

Enable Overkill's authoring rules in ESLint flat config.

```js
import { overkillPlugin } from '@overkill-dev/eslint-plugin';

export default [ {
    plugins: { overkill: overkillPlugin },
    rules: { 'overkill/no-scope-escape': 'error' }
} ];
```

`no-scope-escape` keeps the injected scope, assertion and requirement facades,
and planning method within their owning test or property trial. Pass application
data or individual resource handles to ordinary functions. Use local aliases for
direct assertions and custom assertion references for reusable checks.

Canonical imports work with syntax-only linting. Configure TypeScript parser
services for authoring APIs imported through custom facades. A diagnostic
requires a proven Overkill origin. A closure passed to an opaque function
requires additional evidence that it escapes.

Enable `overkill/no-single-use-trivial-assertion` to flag local assertion
references that forward a built-in check and are used once. For example, a local
`defineCompositeAssertion` whose body is `(check, response) => check.equal(response.status, 200)`
can use `scope.assert.equal(response.status, 200)` directly.

The rule counts source uses through local aliases. A use in a table callback
counts once. Exported references, opaque transfers, narrowing, groups of
multiple checks, and custom diagnostics are preserved.

Enable `overkill/no-self-comparison` to catch equality checks that use the same
value for both operands. For example, `scope.assert.equal(result, result)` and
`scope.assert.equal(result, alias)` are reported when `alias` is a proven copy
of `result`. This also covers proven local data properties and composite check
builders. Repeated reads such as `scope.assert.equal(response.status, response.status)`
are allowed when the rule cannot establish that `status` is a stable data property.
