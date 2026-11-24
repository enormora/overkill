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
keeps its own origin. The escape rule also queries aggregate contents at
transfer sites and retains proven alternatives when branches disagree. Repeated-read stability requires separate evidence.

ESLint parser fixtures and the packed consumer test exercise this tooling under
the integration profiles. The compiler and ESLint probe the host environment
while loading, so the microtest coverage gate excludes the plugin sources.
