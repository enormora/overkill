# `@overkill-dev/test`

Standard user-facing Overkill distribution.

This package currently ships the public `overkill` binary only. The binary
parses the minimal `run` command surface and delegates execution to
`@overkill-dev/run/command-line`.

Supported command-line surface:

- `overkill run [paths...]`
- `overkill list [paths...]`
- `--config <path>`
- `--file <path>`
- `--filter <expr>`
- `--name <text>`
- `--profile <name>`
- `--measure-resource-usage`
- `--resource-budget <name=value>`

`--resource-budget` accepts `activeResourceCount`,
`javaScriptEngineHeapBytes`, `residentSetBytes`, and
`residentSetGrowthBytesPerSecond`. Supplying a resource budget enables
resource usage measurement for that run.

`--filter`, `--name`, and `--file` apply the same run selection to `run` and
`list`. `--filter` supports `=`, `~`, `:`, `!`, `|`, and parentheses over
`tag`, `runtime`, `owner`, `stability`, `file`, `name`, `suite`, and `params`.

When no paths are supplied, `run` and `list` discover files from the selected
profile's `files.include` and `files.exclude` policy. Explicit file paths run
directly. Directory paths filter the selected profile's discovered files and
require that profile policy.

The root authoring facade and standard subpaths are later milestones.
