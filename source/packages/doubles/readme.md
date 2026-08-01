# `@overkill-dev/doubles`

Explicit function-first test doubles for Overkill.

This package is the public home for the doubles model.

Current package state:

- importable facade: `@overkill-dev/doubles`
- primary runtime API: `testDouble()`
- fixed behavior factories: `testDouble.returns(...)`,
  `testDouble.resolves(...)`, `testDouble.rejects(...)`,
  `testDouble.throws(...)`, and `testDouble.constructs(...)`
- configurable behavior rules through `rule.when(...)`, `rule.onCall(...)`,
  `rule.sequence([...])`, and fallback or answer configuration
- direct call, construction, aggregate interaction, result, and reset
  introspection on created doubles
- doubles-oriented assertion extensions are a future milestone
- no module replacement, object-method patching, global sandbox, or restore
  registry API
