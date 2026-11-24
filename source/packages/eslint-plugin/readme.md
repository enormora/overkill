# Overkill ESLint plugin

Enable Overkill's authoring rules in ESLint flat config.

```js
import overkill from '@overkill-dev/eslint-plugin';

export default [{
    plugins: { overkill },
    rules: { 'overkill/no-scope-escape': 'error' }
}];
```

`no-scope-escape` keeps the injected scope, assertion and requirement facades,
and planning method within their owning test or property trial. Pass application
data or individual resource handles to ordinary functions. Use local aliases for
direct assertions and custom assertion references for reusable checks.

Canonical imports work with syntax-only linting. Configure TypeScript parser
services for authoring APIs imported through custom facades. A diagnostic
requires a proven Overkill origin. A closure passed to an opaque function
requires additional evidence that it escapes.
