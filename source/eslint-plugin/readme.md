# Binding analysis

The private analyzer gives ESLint rules the proven origin of an expression at
its use site. Origins are imports, local functions, and function parameters.
Static property paths extend those origins through aliases and destructuring.

To identify an injected scope, a rule resolves the authoring callee and finds
the callback position that receives the scope. Parameter origins carry the
owning function and parameter index for this check.

A conflicting write, unsupported expression, or unreachable use yields an
unknown origin. Local object fields lose their facts when the object can
escape or when an untracked write can change them. A value extracted earlier
keeps its own origin. Repeated-read stability requires separate evidence.

Parser-backed fixtures run under the runtime test profile and use TypeScript
syntax with compiler project mode disabled.
