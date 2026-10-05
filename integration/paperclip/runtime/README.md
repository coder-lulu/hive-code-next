The controlled Linux worker uses Codex 0.159.2 and the fixed `hive-loopback`
Responses provider. Credentials stay in the Host broker; the container has an
empty account home and can reach only its loopback HTTP bridge over the existing
stdio connection. Docker isolation and the Host's request policy remain required.

`hive-models.json` derives the `gpt-6.1-sol` entry from the
[pinned official catalog](https://github.com/openai/codex/blob/ff6aec96948b70d94983af2641a6b67c94faeff5/codex-rs/models-manager/models.json).
Hive projects `input_modalities` to `text` and `experimental_supported_tools` to
an empty list because this worker delivers text/code execution. Responses-lite,
code mode, shell type and the remaining model metadata retain the pinned values.
`catalog-provenance.json` records the source, projection and digest; this projection
does not grant a task access to any resource, account or tool.

`model-tools.json` fixes the tool definitions captured from that pinned Linux
binary using the sealed configuration. Only the code-mode `exec` and `wait`
tools are exposed; `exec` dispatches to local `apply_patch`, `exec_command` and
`write_stdin`. Goals, native subagents, hosted tools, MCP, plugins, images and
web search are disabled. The worker build checks package, catalog, configuration
and tool digests before producing its context. The Host policy rejects changed
definitions; production never learns an allowlist from a guest request.

The upstream catalog and binary use the Apache License 2.0. Applicable attribution
is retained in `codex-LICENSE` and `codex-NOTICE`. Hive's configuration and broker
enforce the delivered subset independently of the upstream model's capabilities.

The broker bounds dispatch count, client concurrency, bytes and time. Aborting a
client stream does not prove that upstream token consumption or billing stopped.
Offline protocol qualification does not certify a real team task or enable its
Runtime capability.
