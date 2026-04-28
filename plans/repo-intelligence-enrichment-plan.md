# Repo Intelligence Enrichment Plan

## Goal

Improve repo intelligence over time through narrow indexing and curated learning from clean missions.

## Why this matters

Once the foundation is trustworthy, enrichment can reduce repeated search and help turn common mission patterns into faster routine work.

## Dependencies

This pass should come after:

- Repo Intelligence Foundation is stable
- thin and then richer mission observability are in place
- there is a clear way to distinguish clean missions from dubious ones

## Scope

### Narrow repo indexing

Start with high-value surfaces only:

- UI string locations
- route/view/component links
- terminology files
- tests coupled to specific UI areas

### Learned pattern candidates

Generate candidate memories and patterns from cleanly completed missions, such as:

- recurring ticket shapes
- effective initial searches
- common files touched
- useful validation defaults
- frequent pitfalls

### Approval and promotion

Use quality states such as:

- `observed`
- `operator-approved`
- `deprecated`

Only approved content should become trusted repo guidance.

## Key design decisions

1. **Promote into the same repo-intelligence store.**  
   Do not create a parallel learning store that bypasses curation.

2. **Prefer narrow indexing first.**  
   The first win is better UI-surface discovery, not a giant semantic graph.

3. **Do not auto-promote learned patterns.**  
   Fast contamination is worse than slow learning.

## Planned deliverables

- repo-surface indexing for the highest-value surfaces
- candidate pattern extraction from clean missions
- operator review and approval workflow
- promotion of approved patterns into repo-intelligence retrieval

## Risks

- learned patterns from imperfect missions become misleading
- review backlog stalls promotions
- indexing scope grows too broad and expensive
- low-confidence entries pollute retrieval quality

## Success criteria

- repeated ticket shapes become easier to route and execute
- agents find likely files and coupled tests faster
- approved learned guidance improves kickoff quality without increasing noise
- the repo-intelligence store becomes better over time without losing trust
