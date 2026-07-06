I agree with the sequencing. Before we define architecture, we need to define the language. Mature platforms (DDD, Kubernetes, AWS, Stripe, etc.) all have a stable vocabulary because architecture cannot be stable if the terminology is not.

One recommendation before we write it: the Lexicon should not be a glossary. A glossary defines words. A lexicon governs the language of the platform.

I would give every canonical term the same structure:

Definition — one authoritative meaning.

Purpose — why it exists.

Owner — which architectural owner governs it.

Relationships — how it connects to other canonical objects.

Invariants — what must always be true.

Non-examples — common misconceptions or things it is explicitly not.

Implementation Notes — optional references to the current V1 realization (without making implementation part of the definition).


That makes the Lexicon directly usable by engineers, AI, documentation, and code reviewers.


---

WhispeRM Lexicon

Version: 1.0

Status: Canonical Vocabulary

Authority: Subordinate to the WhispeRM Constitution and the Engineering Manifest

Purpose: Establish one authoritative definition for every canonical concept used throughout the WhispeRM platform.


---

Principles

One Concept. One Meaning.

Every canonical concept has exactly one authoritative definition.

No document, implementation, test, UI, ADR, or AI-generated contribution may redefine a canonical concept established in this Lexicon.

When terminology conflicts, the Lexicon prevails unless superseded by Constitutional Amendment.


---

Definition Structure

Every canonical concept includes:

Definition

Purpose

Owner

Relationships

Invariants

Non-examples

Implementation Notes (optional)



---

Campaign

Definition

The strategic owner of business intent.

Campaign expresses what the business wants to accomplish.

Campaign never performs execution.

Purpose

To govern acquisition strategy.

Owner

Campaign Domain

Relationships

Campaign

owns Business Growth Opportunities

governs Campaign Runtime

defines Qualification Policy

defines Acquisition Policy


Invariants

Every autonomous acquisition activity belongs to a Campaign.

Campaign owns intent, not execution.

Campaign remains technology-independent.


Non-examples

Campaign is not:

a worker

a scheduler

a queue

a runtime

a provider



---

Business Growth Opportunity

Definition

The canonical economic object of WhispeRM.

It represents a commercially meaningful opportunity to create or expand customer revenue.

Purpose

To unify discovery, acquisition, CRM, revenue attribution, and learning around a single economic objective.

Owner

Campaign Domain

Relationships

Business Growth Opportunity may reference:

Marketplace Capture

Seller

Contact

Deal

Draft Inventory

Revenue Attribution

Learning


Invariants

Every Business Growth Opportunity belongs to one Campaign.

It may aggregate multiple technical records.

It persists beyond individual acquisitions.


Non-examples

Business Growth Opportunity is not:

a listing

a seller

a contact

a deal

a phone number


Those may contribute to a Business Growth Opportunity but are not the object itself.


---

Marketplace Signal

Definition

Raw external evidence suggesting a potential business opportunity.

Purpose

To initiate discovery.

Owner

Discovery

Relationships

Marketplace Signal precedes Marketplace Capture.

Invariants

Ephemeral by nature.

May never be persisted.

Has not yet been qualified.



---

Marketplace Capture

Definition

The canonical technical acquisition boundary.

The first persistent representation of marketplace-derived intelligence.

Purpose

To normalize external marketplace information before qualification and downstream processing.

Owner

Marketplace Acquisition Domain

Relationships

Created from Marketplace Signals.

Feeds:

Qualification

Business Growth Opportunity

CRM Conversion

Campaign Runtime


Invariants

Every marketplace acquisition enters through Marketplace Capture.

Immutable provenance is preserved.

Marketplace Capture is not a CRM record.


Non-examples

Marketplace Capture is not:

a Contact

a Deal

a Seller Claim

a Business Growth Opportunity



---

Qualification

Definition

The governed evaluation of whether a Marketplace Capture should become a Business Growth Opportunity.

Purpose

To prevent low-value data from entering downstream workflows.

Owner

Qualification Service

Invariants

Qualification precedes autonomous acquisition.


---

Campaign Runtime

Definition

The sole orchestration engine for Campaign execution.

Purpose

To transform Campaign strategy into executable work.

Owner

Campaign Runtime

Relationships

Campaign Runtime governs:

Workers

Queues

Retry policy

Execution sequencing

Provider selection


Invariants

Campaign Runtime is the only orchestration engine.


---

Worker

Definition

A bounded execution agent.

Purpose

To perform a single unit of work.

Owner

Runtime

Invariants

Workers never own strategy.


---

Service

Definition

The owner of business behavior.

Purpose

To enforce domain rules.

Owner

Domain

Invariants

Business logic belongs in Services.


---

Repository

Definition

The owner of persistence.

Purpose

To isolate storage implementation from domain behavior.

Owner

Persistence Layer

Invariants

Repositories do not contain business logic.


---

Provider

Definition

An adapter that integrates WhispeRM with external systems.

Purpose

To isolate infrastructure and third-party dependencies from the domain.

Owner

Provider Layer

Examples

WhatsApp

Email

SMS

Marketplace APIs

AI models

Billing gateways


Invariants

Provider failure must not redefine business state.


---

Relationship

Definition

A persistent business connection established between the customer and an acquired party.

Purpose

To represent long-term commercial engagement after acquisition.

Owner

CRM Domain

Invariants

Relationships originate from governed conversion.


---

Revenue Attribution

Definition

The canonical mechanism for connecting commercial outcomes to Business Growth Opportunities and Campaigns.

Purpose

To measure platform effectiveness.

Owner

Revenue Domain

Invariants

Revenue attribution must preserve provenance.


---

Usage Metering

Definition

The canonical mechanism for measuring platform consumption for governance, analytics, and billing.

Purpose

To quantify platform usage independently of commercial outcomes.

Owner

Billing Domain

Invariants

Usage metering measures consumption, not value.


---

Runtime Health

Definition

The authoritative representation of the platform's operational capability.

Purpose

To determine whether WhispeRM can safely execute the Golden Thread.

Owner

Observability

Invariants

Runtime Health reflects live execution capability, not merely configuration.


---

Command Center

Definition

The operational interface for monitoring and managing autonomous execution.

Purpose

To provide operators with visibility into runtime state, governance, health, and execution.

Owner

Operations Domain

Invariants

Command Center visualizes platform state but does not become an orchestration engine.


---

Growth Engine

Definition

The closed-loop learning system that continuously improves Business Growth Opportunity discovery, prioritization, acquisition, and conversion using operational outcomes.

Purpose

To increase the quantity, quality, speed, and realization of Business Growth Opportunities over time.

Owner

Growth Domain

Invariants

The Growth Engine learns from platform outcomes but does not override constitutional governance or campaign intent.


---

Canonical Ownership Summary

Concept	Canonical Owner

Campaign	Campaign Domain
Business Growth Opportunity	Campaign Domain
Marketplace Signal	Discovery
Marketplace Capture	Marketplace Acquisition Domain
Qualification	Qualification Service
Campaign Runtime	Runtime
Worker	Runtime
Service	Domain
Repository	Persistence
Provider	Provider Layer
Relationship	CRM
Revenue Attribution	Revenue Domain
Usage Metering	Billing Domain
Runtime Health	Observability
Command Center	Operations Domain
Growth Engine	Growth Domain



---

Closing Principle

Language shapes architecture.

Architecture shapes implementation.

Implementation shapes the product.

By maintaining a single authoritative vocabulary, WhispeRM preserves conceptual integrity across governance, architecture, implementation, operations, and AI-assisted development.

Every contributor is responsible for protecting the principle:

> One Concept. One Meaning.



I recommend storing this as:

docs/governance/lexicon.md

It should become a required reference for every future governance document, ADR, and stabilization slice.
