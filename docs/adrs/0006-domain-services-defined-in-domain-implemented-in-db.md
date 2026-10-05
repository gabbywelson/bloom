# 0006. Domain service interfaces live in domain, implementations in db

Date: 2026-10-04

## Context

Agent tools and integrations must mutate state only through domain
services so every change is audited. `packages/domain` holds schemas only
and cannot depend on the database. `packages/agent` must not know about
SQL. Something has to own the service _contracts_.

## Decision

- `packages/domain` defines the service tags and interfaces
  (`Context.Service`), e.g. `TaskService`, `ThreadService`,
  `MessageService`, `EventSink`, plus their tagged errors.
- `packages/db` implements them as Layers over the repositories. Mutating
  methods also append an `Event` row (`source: "domain"`), which is the
  audit log.
- `packages/agent` tools depend only on the domain tags.
  `apps/server` wires the db Layers in.

## Consequences

- Tests for agent tools and for the API use in-memory Layers of the same
  tags; no database needed.
- Adding an entity means: schema + service interface in domain, repository
  - service layer in db, endpoints in api.
