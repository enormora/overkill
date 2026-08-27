# `@overkill-dev/test`

Standard user-facing Overkill distribution.

This package currently ships the public `overkill` binary only. The binary
parses the minimal `run` command surface and delegates execution to
`@overkill-dev/run/command-line`.

Supported command-line surface:

- `overkill run [paths...]`
- `--config <path>`
- `--profile <name>`
- `--measure-resource-usage`
- `--resource-budget <name=value>`

`--resource-budget` accepts `activeResourceCount`,
`javaScriptEngineHeapBytes`, `residentSetBytes`, and
`residentSetGrowthBytesPerSecond`. Supplying a resource budget enables
resource usage measurement for that run.

The root authoring facade and standard subpaths are later milestones.
