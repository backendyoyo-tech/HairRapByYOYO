# YOYO Phase 1 — Authoritative Project Documents

This directory contains the controlled authoritative documents for the
Hair Rap By YOYO Phase 1 implementation.

These documents are implementation references for developers, reviewers,
and AI/Hermes agents.

---

## 1. How to Use These Documents

Before implementing a task:

1. Read the current task/node packet.
2. Read only the exact authoritative source documents/sections named by
   that task packet.
3. Follow the applicable approved business decisions and current runtime
   contracts.
4. Do not use historical documents when they have been superseded.
5. Do not guess unresolved business or production configuration values.
6. If authoritative documents conflict and the conflict cannot be resolved
   by the defined hierarchy, stop the affected work and raise a decision
   request to the BA/Product Owner.

---

## 2. Master Implementation Index

File:

`YOYO_Phase_1_Master_Implementation_Index_v1.docx`

Purpose:

Defines the project authority order and role-specific reading sets.

Backend developers primarily use:

- API Contract
- ERD
- RBAC
- Relevant state machines
- Validation contract

Hermes/AI agents must use:

- The current node packet
- The exact authoritative source references named by that packet

Agents must not browse historical documents unless specifically instructed.

---

## 3. Product Scope & Delivery Baseline

File:

`YOYO_Phase_1_Product_Scope_Delivery_Baseline_v1.1_ALIGNED.docx`

Purpose:

Defines the Phase 1 product scope, delivery baseline, source-of-truth
hierarchy, change-control expectations, Hermes execution model, and
deployment-readiness expectations.

Phase 1 consists of:

- Admin Panel
- Artist App
- Client Booking App

These products use:

- One shared backend/API
- One PostgreSQL source of truth
- Shared business rules
- Shared live operational data

Material changes to behaviour, data, APIs, RBAC, state machines, or
financial rules require controlled review.

---

## 4. Environment, Deployment & Go-Live Specification

File:

`YOYO_Phase_1_Environment_Deployment_and_Go_Live_Specification_v1.1_ALIGNED.docx`

Purpose:

Defines:

- Environment separation
- Environment variables and secret handling
- Database and migration policy
- Branching and release strategy
- Deployment order
- Production smoke tests
- Monitoring and logging
- Stop-ship criteria
- Rollback and recovery
- Environment-specific integration configuration

Production secrets must never be committed to source code or exposed in
agent prompts.

---

## 5. API & Data Contract

File:

`YOYO_Phase_1_API_and_Data_Contract_v1.1_ALIGNED.docx`

Purpose:

Defines the canonical backend interface between:

- Admin Panel
- Artist App
- Client Booking App
- Shared PostgreSQL database

It is authoritative for:

- HTTP interface shape
- Canonical JSON field names
- API data types
- Endpoint authorization
- Transaction boundaries
- Idempotency keys
- Concurrency rules
- Error envelopes
- API/data mapping

The API baseline is:

`/api/v1`

Backend implementations must preserve the approved contract and must not
silently change business rules defined by the relevant state machines or
approved domain contracts.

---

## 6. AI / Hermes Agent Rules

AI/Hermes agents are implementation assistants and do not have authority
to redefine business rules.

Agents must:

- Work only within the approved task/contract slice.
- Use bounded feature branches/worktrees.
- Follow the current authoritative documents.
- Preserve API and domain contracts.
- Run self-tests and verification.
- Produce evidence for completed work.
- Report unresolved conflicts instead of guessing.
- Never bypass RBAC, confirmation, payment, or state-machine controls.
- Never write directly to the production database through an AI interface.

Agent completion statements without implementation and test evidence are
not considered project completion.

---

## 7. Intentionally Open Business / Configuration Items

The following items are intentionally unresolved and must not be invented
by developers or AI agents:

- OPEN-01 — Final GST / tax / HSN-SAC / invoice statutory configuration
- OPEN-02 — Final artist revenue-allocation basis/formula
- OPEN-03 — Exact service-master rows requiring two artists
- OPEN-04 — Exact high-risk service list and final legal consent wording

These values must remain configuration-driven until formally resolved.

---

## 8. Historical Documents

Historical or superseded documents are not implementation authority when
a newer approved document supersedes them.

Do not introduce older rules into the current implementation.

When documents conflict:

1. Apply the applicable authority hierarchy.
2. Do not silently merge conflicting rules.
3. If the conflict remains unresolved, stop the affected work.
4. Raise a decision request to the BA/Product Owner.

---

## 9. Important Principle

The repository is the shared implementation context for human developers
and AI/Hermes agents.

However, the presence of a document in this directory does not by itself
make every statement inside that document the highest authority.

Always follow the current project authority hierarchy and the exact
references specified by the active task/node.