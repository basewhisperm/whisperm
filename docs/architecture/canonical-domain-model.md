# Canonical Domain Model

Version: 1.0

Status: Canonical Architecture Document

Building Epoch

---

# Purpose

This document defines the shared domain language of WhispeRM.

Every engineer, AI agent, architecture document, ADR, implementation slice, and production feature shall use the terminology defined here.

One concept shall have one meaning.

One meaning shall have one owner.

---

# Constitutional Alignment

Identity

WhispeRM is an Autonomous Acquisition Platform serving as the Autonomous Revenue Engine for businesses.

Mission

WhispeRM exists to continuously supply Business Growth Opportunities through autonomous acquisition.

Promise

Growth Opportunity. Every Day.

Primary Business Object

Campaign

Primary Economic Object

Business Growth Opportunity

---

# Domain Philosophy

WhispeRM transforms marketplace activity into Business Growth Opportunities.

Every canonical object must either:

- create Business Growth Opportunities
- improve Business Growth Opportunities
- pursue Business Growth Opportunities
- realize Business Growth Opportunities
- learn from Business Growth Opportunities

Objects that do none of these should not become first-class domain concepts.

---

# Canonical Flow

Markets

↓

Marketplace Signals

↓

Marketplace Intelligence

↓

Potential Opportunities

↓

Seller Intelligence

↓

Business Growth Opportunities

↓

Campaign Decisions

↓

Autonomous Workers

↓

Relationships

↓

Revenue Events

↓

Learning Events

↓

Improved Intelligence

---

# Canonical Objects

## Campaign

Purpose

Campaign is the primary business object.

Campaign defines autonomous business strategy.

Campaign owns business intent.

Campaign does not perform work.

Workers execute Campaign intent.

Owns

- Business objectives
- Marketplace strategy
- Qualification policy
- Acquisition policy
- Automation policy
- Scheduling
- Business Growth Opportunities
- Success metrics

Created By

- Customer
- Authorized user
- Future AI-assisted strategy builder

Consumed By

- Discovery workers
- Qualification workers
- Acquisition workers
- Reporting systems
- Learning systems

Commands

- Create Campaign
- Activate Campaign
- Pause Campaign
- Resume Campaign
- Archive Campaign
- Update Campaign Strategy

Events

- CampaignCreated
- CampaignActivated
- CampaignPaused
- CampaignResumed
- CampaignArchived
- CampaignStrategyUpdated

Invariants

- Every acquisition workflow must belong to a Campaign.
- Campaign owns strategy, not execution.
- Campaign state must control autonomous execution.

---

## Business Growth Opportunity

Purpose

Business Growth Opportunity is the primary economic object of WhispeRM.

Definition

A Business Growth Opportunity is a qualified opportunity capable of measurably expanding a business.

Lifecycle

Potential

↓

Qualified

↓

Prioritized

↓

Pursuing

↓

Relationship

↓

Realized

Created By

- Seller Intelligence
- Campaign qualification policy
- Future business intelligence engines

Consumed By

- Campaign decisions
- Autonomous acquisition
- Relationship management
- Revenue reporting
- Learning systems

Commands

- Qualify Opportunity
- Prioritize Opportunity
- Assign Opportunity
- Pursue Opportunity
- Archive Opportunity
- Realize Opportunity

Events

- OpportunityCreated
- OpportunityQualified
- OpportunityPrioritized
- OpportunityPursuitStarted
- OpportunityArchived
- OpportunityRealized

Invariants

- Business Growth Opportunity must be tied to a Campaign.
- Business Growth Opportunity must have a qualification basis.
- Business Growth Opportunity must be measurable or expected to become measurable.

---

## Marketplace

Purpose

Marketplace represents an external commercial ecosystem from which signals originate.

Examples

- Jiji
- Facebook Marketplace
- Craigslist
- eBay Motors
- Tonaton
- Jumia

Owns

- Marketplace identity
- Source configuration
- Marketplace-specific constraints
- Signal source metadata

Consumed By

- Marketplace Intelligence
- Discovery workers
- Campaign strategy

Invariants

- Marketplace is a source of signals, not the owner of opportunities.
- Marketplace-specific behavior should be isolated behind adapters or source-specific boundaries.

---

## Marketplace Signal

Purpose

Marketplace Signal represents raw observable marketplace activity.

Examples

- Listing
- Listing update
- Seller profile
- Price change
- Inventory change
- Category page
- Search result page

Created By

- Discovery workers
- Manual capture
- Imports
- Future marketplace connectors

Consumed By

- Marketplace Intelligence

Invariants

- Marketplace Signals are not Business Growth Opportunities.
- Signals must be preserved with source provenance where practical.
- Signals should be deduplicated before qualification when possible.

---

## Marketplace Intelligence

Purpose

Marketplace Intelligence transforms Marketplace Signals into Potential Opportunities.

Responsibilities

- Discovery
- Extraction
- Normalization
- Deduplication
- Classification
- Enrichment
- Marketplace trend detection

Input

- Marketplace Signals

Output

- Potential Opportunities

Events

- MarketplaceSignalDiscovered
- MarketplaceSignalNormalized
- MarketplaceSignalDeduplicated
- PotentialOpportunityCreated

Invariants

- Marketplace Intelligence does not create CRM records.
- Marketplace Intelligence does not send invitations.
- Marketplace Intelligence prepares opportunity inputs for Seller Intelligence.

---

## Potential Opportunity

Purpose

Potential Opportunity is an intermediate object between raw marketplace signal and qualified Business Growth Opportunity.

It represents a possible opportunity that has not yet been fully qualified.

Created By

- Marketplace Intelligence

Consumed By

- Seller Intelligence

Lifecycle

Discovered

↓

Enriching

↓

Ready For Qualification

↓

Qualified as Business Growth Opportunity

or

Archived

Events

- PotentialOpportunityCreated
- PotentialOpportunityEnriched
- PotentialOpportunityReadyForQualification
- PotentialOpportunityArchived

Invariants

- Potential Opportunity is not yet a Business Growth Opportunity.
- Potential Opportunity must not be treated as ready for acquisition.
- Potential Opportunity exists to protect quality and prevent CRM pollution.

---

## Seller Intelligence

Purpose

Seller Intelligence evaluates Potential Opportunities and produces Business Growth Opportunities.

Responsibilities

- Seller identity resolution
- Seller deduplication
- Confidence scoring
- Qualification scoring
- Opportunity scoring
- Campaign matching
- Prioritization

Input

- Potential Opportunities
- Campaign policy
- Historical outcomes

Output

- Business Growth Opportunities

Events

- SellerIdentityResolved
- SellerDuplicateDetected
- OpportunityScored
- OpportunityQualified
- OpportunityRejected

Invariants

- Seller Intelligence qualifies opportunity.
- Seller Intelligence does not own Campaign strategy.
- Seller Intelligence must preserve confidence and reasoning where practical.

---

## Relationship

Purpose

Relationship represents a realized Business Growth Opportunity.

Relationships are managed operationally by CRM capabilities.

Created By

- Claim
- Conversion
- Successful acquisition workflow

Consumed By

- CRM
- Revenue reporting
- Learning systems

Events

- RelationshipCreated
- RelationshipUpdated
- RelationshipActivated

Invariants

- CRM manages Relationships.
- CRM does not create Business Growth Opportunities.
- Relationship is downstream of acquisition.

---

## Autonomous Worker

Purpose

Autonomous Worker executes Campaign intent.

Examples

- Discovery Worker
- Qualification Worker
- Invitation Worker
- Follow-up Worker
- Claim Worker
- Learning Worker

Created By

- Platform runtime
- Scheduler
- User-triggered execution
- Future orchestration engine

Consumed By

- Campaigns
- Operations
- Observability

Events

- WorkerStarted
- WorkerCompleted
- WorkerFailed
- WorkerRetried

Invariants

- Workers execute strategy.
- Workers do not own strategy.
- Workers must be observable, idempotent, and tenant-scoped.

---

## Revenue Event

Purpose

Revenue Event represents measurable business value produced from a Relationship or realized opportunity.

Examples

- Seller converted
- Customer acquired
- Subscription activated
- Referral received
- Transaction completed

Created By

- Conversion systems
- Billing systems
- CRM events
- Future revenue attribution systems

Consumed By

- Analytics
- Learning systems
- Campaign performance reporting

Events

- RevenueEventRecorded
- RevenueAttributed
- RevenueRealizationUpdated

Invariants

- Revenue Event validates Business Growth Opportunity quality.
- Revenue Event should be attributable to Campaign where possible.

---

## Learning Event

Purpose

Learning Event captures outcome knowledge that improves future intelligence.

Sources

- Discovery
- Qualification
- Invitation
- Claim
- Conversion
- Revenue
- Rejection
- Failure
- Manual review

Consumed By

- Marketplace Intelligence
- Seller Intelligence
- Campaign optimization
- Future AI systems

Events

- LearningEventRecorded
- CampaignLearningUpdated
- IntelligenceModelImproved

Invariants

- Every meaningful success or failure should be eligible to become a Learning Event.
- Learning must preserve tenant boundaries and customer trust.
- Learning should improve future Business Growth Opportunities.

---

# Ownership Rules

Campaign owns strategy.

Business Growth Opportunity owns economic value.

Marketplace owns source identity.

Marketplace Signal owns raw evidence.

Marketplace Intelligence owns transformation from signal to potential opportunity.

Potential Opportunity owns pre-qualification state.

Seller Intelligence owns qualification.

Autonomous Worker owns execution.

Relationship owns realized trust.

Revenue Event owns realized value.

Learning Event owns improvement.

---

# Engineering Rules

Every persistent object must belong to one canonical domain object.

Every service must declare which canonical object it serves.

Every API must map to a canonical object or a clear cross-object workflow.

Every new state transition should produce or consume a domain event where practical.

No implementation should introduce duplicate meanings for existing concepts.

No feature should bypass Campaign ownership for acquisition workflows.

No discovery workflow should directly create CRM records.

---

# Constitutional Test

Every architectural proposal should answer:

1. Which canonical object owns this capability?
2. Which canonical object consumes this capability?
3. How does this increase or improve Business Growth Opportunities?
4. Does this preserve Campaign as the primary business object?
5. Does this protect CRM from pre-acquisition noise?
6. Does this create learning that can improve future opportunity supply?

If ownership is ambiguous, the proposal is not ready.

---

# Canonical Principle

Campaign owns strategy.

Workers execute strategy.

Marketplace Intelligence discovers potential.

Seller Intelligence qualifies opportunity.

Business Growth Opportunities create value.

Relationships realize value.

Revenue validates value.

Learning compounds value.

Everything exists to fulfill the WhispeRM Promise.

Growth Opportunity.

Every Day.
