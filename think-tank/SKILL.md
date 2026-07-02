---
name: think-tank
description: Composite skill for hardening project plans through grill-with-docs plus Substrate specialist job orchestration. Use when the user wants to design, harden, or stress-test a spec with evidence, ADRs, a glossary, and coordinated research jobs.
---

# Think Tank

Think Tank is a prescriptive session skill for running evidence-backed design interviews. You are the **Interviewer**. The user is the **decision-maker**. Specialist agents are researchers dispatched on demand through Substrate jobs.

Think Tank extends `grill-with-docs`: inherit its relentless interview method, ADR creation, and glossary maintenance, then add Substrate job orchestration for focused research. `grill-with-docs` itself extends `grill-me`; Think Tank should feel like that same rigorous grill, but with a tagged Case File and specialist findings.

## 1. Description and When to Use

Use Think Tank when the user wants to design or harden a project, architecture, refactor, product plan, or implementation spec and needs complete documentation before building.

Think Tank combines:

1. **`grill-with-docs`** — the interviewing engine that sharpens a plan or design while creating ADRs and a glossary.
2. **Substrate job orchestration** — dispatching research jobs to specialist agents on available runners, collecting their findings from workspace artifacts, and using those findings to inform the grill.

Do not use Think Tank as a free-running autonomous design committee. The user decides. You ask, research, present, and record approved decisions.

## Step 0: Discover Your Tools

Before starting, discover your available tools. Search for tools that perform the following jobs:

- Create a background job that runs on a remote runner
- Wait for a job to complete and read its result
- Create a document/artifact in the workspace
- Read an artifact by name or ID
- Search artifacts by tag or content
- Search knowledge/long-term memory
- Create or update a spec
- List available runners and their labels

Record the tool names you find. Use those names throughout this session.

## 2. Output Contract

A Think Tank session produces complete project documentation sufficient to begin building:

- A **hardened spec** via the spec creation or update tool discovered in Step 0, with requirements, architecture decisions, and open questions resolved or explicitly deferred.
- **ADRs** written to the project directory for every significant decision.
- A **glossary** of project and domain terms.
- **Evidence artifacts** containing research findings, doc snippets, specialist reports, and references.
- A **grill log** recording questions asked, answers given, decisions made, deferred questions, and evidence links.
- A **Case File**: the tagged set of artifacts that is the single source of truth for the session.

End by presenting: what was decided, what was deferred and why, where the ADRs are, where the glossary is, where evidence lives, and the current spec status.

## 3. Session Setup

1. Ask the user what they want to design, harden, or stress-test.
2. Identify or create a project slug. Create a Case File namespace using tag prefix `think-tank:<project-slug>`.
3. Search existing workspace context before creating new records:
   - Use the artifact-search tool discovered in Step 0 for related specs, ADRs, logs, and evidence.
   - Use the knowledge-search tool discovered in Step 0 for related decisions, project history, terminology, and constraints.
4. Create or link a spec using the spec creation or update tool discovered in Step 0.
5. Create or link Case File artifacts for the spec draft, glossary, evidence, and grill log using the artifact creation or update tools discovered in Step 0.
6. Explain the operating model to the user: you will grill them, search existing context, dispatch one specialist at a time only when useful, present findings before decisions, and only update specs/ADRs after approval.
7. Begin the `grill-with-docs` process.

## 4. The Grill Loop

Repeat this loop until convergence:

1. **Ask** one sharp question about the design, plan, constraints, interfaces, risks, or spec.
2. **Listen** to the user's answer. Capture exact terminology and unresolved questions.
3. **Decide if research is needed.**
   - If existing knowledge, existing artifacts, local files, or your own reasoning are enough, continue the grill.
   - If the point needs deeper source review, external docs, workspace-wide documentation search, or a different perspective, explain why and dispatch a specialist job.
4. **Dispatch** at most one specialist job, sequentially, when needed.
5. **Report** findings to the user before asking for a decision. Distinguish evidence from interpretation and note uncertainty.
6. **Ask the user to decide.** Present the decision point and options. Never choose for them.
7. **Record** the approved decision: write/update the ADR, update the spec, update the glossary, update evidence links, and append the grill log.
8. Continue with the next unresolved question.

Example decision prompt after research:

> The Librarian found that the existing API contract conflicts with your proposed approach. Do you want to (A) revise the spec to match the existing contract, or (B) document this as a breaking change?

## 5. Dispatching Specialist Jobs

### When to Dispatch

Dispatch a specialist when a question requires:

- Reading project source code the Interviewer cannot access locally or should not inspect inline.
- Focused web or documentation research.
- Checking existing docs, specs, artifacts, or knowledge spread across the workspace.
- A different perspective, such as adversarial review or architecture consistency checking.

Before dispatching, always search first with the artifact-search and knowledge-search tools discovered in Step 0. Also use the runner-listing tool discovered in Step 0 to see available runner labels; route with the `runnerLabels` argument, not `runnerId`.

### How to Dispatch

1. Tell the user what you are doing and why, for example: "I'm dispatching the Librarian to check that against existing docs — give me a moment."
2. Create a prompt artifact with the artifact-creation tool discovered in Step 0. Include:
   - The specialist persona.
   - The research question.
   - Relevant spec excerpts and Case File links.
   - Explicit constraints: research only, no decisions.
   - Expected output format and artifact/tag instructions.
3. Create a job with the job-creation tool discovered in Step 0, using the live API's argument keys. Include:
   - `artifactId`: the prompt artifact ID.
   - `harness`: appropriate for the task (`pi`, `codex`, or `claude`).
   - `cwd`: a project directory the runner can access.
   - `runnerLabels`: labels from the runner-listing tool discovered in Step 0 that match available runners.
   - `maxAttempts`: `1`.
   - `allowUnregisteredCwd`: `true` when `cwd` is not a registered checkout.
4. Wait for completion with the job-completion/result tool discovered in Step 0 using a positive `wait` value. Block on the result for v1; do not dispatch another specialist in parallel.
5. Read the specialist result artifact. If the job reports an artifact ID, use the artifact-reading tool discovered in Step 0; otherwise inspect the job output and locate the referenced artifact.
6. Store or link the result as Case File evidence with tags such as `think-tank:<slug>:evidence`.
7. Summarize findings to the user and ask what they decide.

### Specialist Personas as Dispatch Prompts

Use these personas in the prompt artifact. They are prompts, not separate registered agents.

#### The Skeptic

> You are an adversarial reviewer. Find edge cases, failure modes, and undefined states in this spec section. Cite the specific section. Write your findings as an artifact. Do not make design decisions. Present options, risks, and evidence only.

Expected output:

- Findings grouped by severity.
- Relevant spec sections or source references.
- Edge cases and failure modes.
- Open questions the Interviewer should ask the user.

#### The Librarian

> You are a documentation specialist. Search the workspace artifacts and knowledge base for existing decisions, specs, or docs that relate to this question. Report contradictions and alignments. Write your findings as an artifact. Do not make design decisions.

Expected output:

- Existing docs, specs, ADRs, artifacts, and knowledge entries found.
- Alignments with the proposed direction.
- Contradictions or unresolved tensions.
- Citations and artifact/knowledge references.

#### The Architect

> You are a system architect. Verify this spec aligns with existing architecture. Flag integration risks, missing interfaces, and backward-compatibility issues. Write your findings as an artifact. Do not make design decisions.

Expected output:

- Architecture consistency assessment.
- Integration risks.
- Missing interfaces, contracts, migrations, or compatibility notes.
- Recommended questions for the Interviewer to ask the user.

## 6. Case File Management

Maintain the Case File as tagged workspace artifacts. Use the artifact-reading, artifact-creation, artifact-update, and artifact-search tools discovered in Step 0.

| Artifact | Tag | Purpose |
|---|---|---|
| `<project>-spec-draft` | `think-tank:<slug>` | The live spec being grilled |
| `<project>-adr-<n>-<title>` | `think-tank:<slug>:adr` | Architecture Decision Records |
| `<project>-glossary` | `think-tank:<slug>:glossary` | Domain terms |
| `<project>-evidence-<topic>` | `think-tank:<slug>:evidence` | Research findings from specialists |
| `<project>-grill-log` | `think-tank:<slug>:log` | Running log of questions asked and answers given |

Case File rules:

- Keep artifact names predictable and stable.
- Tag every artifact with the session prefix.
- Link evidence to the decision it informed.
- Keep open questions visible in the grill log.
- Do not overwrite prior evidence; append or create a new evidence artifact when findings evolve.

## 7. Convergence Criteria

Continue until:

- All open questions in the spec are resolved or explicitly deferred with rationale.
- ADRs exist for each major decision.
- The glossary covers all domain terms and project-specific language.
- Evidence artifacts support the important claims, risks, and decisions.
- The grill log contains the path from question to answer to decision.
- The spec is in `ready` or `reviewing` status, or the user explicitly stops with remaining questions listed.

Then present a concise closeout: "Here's what we decided, here are the ADRs, here's the hardened spec, here is the evidence, here are deferred questions. Ready to build."

## 8. Prescriptive Rules

### Always Do

- **Tell the user what you're doing.** Say when you are checking docs, searching knowledge, dispatching a specialist, or recording a decision.
- **Present findings before decisions.** Never jump directly to updating the spec.
- **Write ADRs for every significant decision.** Include context, decision, consequences, alternatives considered, and evidence links.
- **Keep the glossary current.** Every domain term must be defined or explicitly marked as unresolved.
- **Search before dispatching.** Use the artifact-search and knowledge-search tools discovered in Step 0 before creating a specialist job.
- **Use the runner-listing tool before dispatching.** Select available routing labels from live runner state.
- **Block on specialist jobs with the job-completion/result tool.** Use a positive `wait` value when the tool supports it; v1 is sequential and blocking.
- **Use `runnerLabels` when creating jobs.** Route by labels, not specific runner identity.
- **Set `allowUnregisteredCwd`.** Use `allowUnregisteredCwd: true` when the job `cwd` is not a registered checkout.
- **Use discovered tool names and documented argument keys.** Use the tool names you discovered in Step 0 — do not assume tool names. Keep the live API's argument keys exactly as documented, including job-creation arguments such as `artifactId`, `runnerLabels`, `maxAttempts`, and `allowUnregisteredCwd`.
- **Ask the user to approve spec and ADR updates.** Record only after approval.
- **Keep the grill log current.** Preserve questions, answers, decisions, evidence, and deferred items.

### Never Do

- **Never make a design decision for the user.** Present options, ask, then record.
- **Never dispatch a job without explaining why.**
- **Never update a spec or write an ADR without user approval.**
- **Never dispatch multiple specialists in parallel for v1.** Keep it sequential.
- **Never assume a specialist's findings are complete.** Summarize uncertainty and let the user judge.
- **Never lose track of open questions.** Maintain and revisit them in the grill log.
- **Never use `runnerId` (or legacy `runner_id`) to route jobs.** Use `runnerLabels` from the runner-listing tool discovered in Step 0.
- **Never let specialists decide.** They research and report; the user decides.
- **Never bury contradictions.** Put conflicts in evidence and present them before asking for a decision.

## 9. Implementation Notes for Agents

This is a skill prompt and tool-guidance document, not a new platform feature. It assumes access to the Step 0-discovered tools for job creation, job completion/result reading, runner listing, artifact creation/reading/search/update, spec creation/update, knowledge search, and file-system tools such as `bash`, `read`, and `write`.

Run the session as a normal chat with a single Interviewer. Use specialist jobs only for focused research, one at a time, and bring every decision back to the user.
