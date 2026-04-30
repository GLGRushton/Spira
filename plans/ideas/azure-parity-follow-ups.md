# Azure parity follow-ups

## Remaining follow-ups after Phase 4 durable continuity

1. **Cooperative tool cancellation**
   - Azure provider abort now cleanly stops the model turn, but host tools that have already started can still keep running to completion.
   - This matters most for mutating tools such as `apply_patch`, `write_file`, `powershell`, and similar write-capable operations.
   - Follow-up goal: thread abort intent through the host tool execution contract so in-flight tools can stop cooperatively or be treated as unrecoverable side-effect boundaries.

2. **Provider-managed system-prompt provenance**
   - Host-managed Azure continuity now checks provider, manifest/projection, and system-prompt provenance before reuse.
   - Provider-managed session resume still needs the equivalent system-prompt provenance guard so persisted provider sessions are not resumed under stale instructions after restart or configuration drift.
   - Follow-up goal: persist and validate system-message provenance alongside provider-managed binding state before allowing resume.
