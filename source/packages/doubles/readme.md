# `@overkill-dev/doubles`

Explicit function-first test doubles for Overkill.

This package is the public home for the doubles model.

Current package state:

- importable facade: `@overkill-dev/doubles`
- primary runtime API: `testDouble()`
- fixed behavior factories: `testDouble.returns(...)`,
  `testDouble.resolves(...)`, `testDouble.rejects(...)`,
  `testDouble.throws(...)`, and `testDouble.constructs(...)`
- rule configuration, call history introspection, and doubles-oriented
  assertion extensions are future milestones
- no module replacement, object-method patching, global sandbox, or restore
  registry API
