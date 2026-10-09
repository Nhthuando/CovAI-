# CovAI System Context Diagram Implementation Plan

> **For agentic workers:** Produce and verify the diagram as one atomic documentation deliverable.

**Goal:** Create a proposal-accurate, submission-ready CovAI System Context Diagram.

**Architecture:** Use one monochrome C4 System Context view with CovAI at the
center, one person, and three external systems. Keep internal containers and
data stores outside this abstraction level.

**Tech Stack:** PlantUML and SVG.

## Global Constraints

- The target source of truth is `specs/C1SE.30_Proposal_ver1.1.docx`.
- Preserve the proposal's GitHub webhook and Docker isolation capabilities.
- Do not mix Container or Deployment Diagram details into the context diagram.
- Use plain black-and-white C4 notation without decorative styling.

---

### Task 1: Create and verify the diagram

**Files:**

- Create: `docs/architecture/diagrams/covai-system-context.puml`
- Create: `docs/architecture/diagrams/covai-system-context.svg`
- Create: `docs/architecture/system-context.md`

**Interfaces:**

- Consumes: proposal actors, external systems, responsibilities, and data flows.
- Produces: portable PlantUML source and an immediately usable vector image.

- [ ] Encode the approved C4-style context in standalone PlantUML.
- [ ] Produce an equivalent SVG without external fonts or libraries.
- [ ] Verify entity names, arrow directions, labels, proposal constraints, and
      exclusion of internal container-level technologies.
- [ ] Document how to render and embed the deliverable.
