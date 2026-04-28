# Repo Intelligence Enrichment

## Goal

Improve repo intelligence over time by indexing high-value code surfaces and learning from successful missions without polluting trusted guidance.

## Combines

- repo indexing and UI surface maps
- successful mission learning and curation

## Recommendation

Treat this as phase two of repo intelligence. Build it after the foundation exists, so learned and indexed knowledge has somewhere coherent to live.

## Scope

### 1. Repo indexing and UI surface maps

Index high-value repo surfaces such as:

- user-facing strings
- view and component locations
- route-to-view mappings
- constants and terminology files
- tests coupled to specific UI areas
- common labels and their likely source files

Use this to answer questions like:

- where does this wording live?
- what tests are coupled to this screen?
- what files usually control this label?

### 2. Successful mission learning and curation

Learn primarily from successful, cleanly closed missions. Candidate learned patterns include:

- recurring ticket shapes
- best initial searches
- common files touched for a pattern
- effective validation choices
- default proof level
- common pitfalls
- explicit negative memory such as "do not rename this term here"

Use at least three memory quality states:

- observed
- operator-approved
- deprecated or suppressed

## Storage recommendation

Use **SQLite** and promote learned patterns into the same repo-memory model established in the foundation pass.

## Crossovers

- Extends **Repo Intelligence Foundation** rather than creating a separate knowledge store.
- Strengthens **Proof Decisioning** and validation defaults with evidence from successful missions.
- Relies on **Mission Observability and Workflow Polish** to identify which missions are safe to learn from.

## Initial recommendation

Start with a narrow UI-copy-oriented index and only auto-suggest candidate memories from successful missions; require lightweight operator review before promoting them to trusted guidance.
