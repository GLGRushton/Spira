# Suggested Implementation Order

## Recommended sequence

1. **Proof Decisioning**  
   Highest likely speed win. Combines proof proportionality, proof preflight, and the validation foundations that influence proof choice.

2. **Repo Intelligence Foundation**  
   Reduces orientation overhead and makes repo guidance available at kickoff through cheat sheets, repo memory, and initial validation profiles.

3. **Mission Observability and Workflow Polish**  
   Makes future improvements measurable and keeps visible mission state aligned with actual lifecycle facts.

4. **Repo Intelligence Enrichment**  
   Adds indexing and curated learning once the foundation is stable enough to absorb richer knowledge safely.

## Why this order

The first two passes attack the biggest sources of avoidable mission drag:

- over-heavy proof decisions
- late proof failure discovery
- slow repo orientation
- validation-command selection overhead

Observability follows before deeper enrichment so later tuning is evidence-based. Enrichment comes last because indexed and learned knowledge should extend a stable repo-memory model, not invent a second one.

## Notes on overlap

- **Proof Decisioning** should consume repo rules and validation defaults from **Repo Intelligence Foundation**.
- **Repo Intelligence Enrichment** should promote into the same SQLite-backed repo-memory model created by **Repo Intelligence Foundation**.
- **Mission Observability and Workflow Polish** should measure the effect of the first two passes and identify which successful missions are safe to learn from.

## Storage recommendation

Use **SQLite** as the common local operational store for all four passes unless and until there is a clear need for centralized shared memory.
