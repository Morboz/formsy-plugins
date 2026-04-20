# Coding Context Compiler Cloud Service — Overall Architecture & Plugin Design

## 1. Executive Summary

This document defines the **final target architecture** for a cloud-native **Coding Context Compiler** service for coding agents.

The service has two commercial/product surfaces:

1. **Context API**  
   The agent/plugin calls the service, receives a compiled context package / prompt bundle, and then submits that content to the developer’s chosen LLM.

2. **Gateway API**  
   The agent/plugin calls the service once; the service first performs context compilation, then directly routes the final prompt to a managed LLM gateway and returns the model response / patch / streaming tokens.

The architecture is intentionally inspired by the successful Vercel pattern:
- **Monorepo + many focused packages**
- **thin client SDKs / plugins**
- **provider adapters**
- **gateway abstraction**
- **clear split between internal engine APIs and external product APIs**

This proposal treats your existing pipeline as the **internal execution engine**, not the final external API contract.

---

## 2. Starting Point: Existing Internal Engine

Your current code API already defines a solid internal pipeline:

- **S1 scan**: repo AST and error extraction
- **S2 ingest**: artifact ingestion into `CodeEpisodeStore`
- **S3 query**: compile `QueryPlan`
- **S4 context**: compile `ContextPackage`
- **S5 patch**: generate patch
- **S6 verify**: apply patch and run tests

This is a good internal architecture because it separates:
- repository understanding,
- problem formalization,
- context assembly,
- patch generation,
- verification.

However, as an external product interface, exposing S1–S6 directly is too low-level for most developers and plugin ecosystems.

### Final positioning

- **Internal Engine API**: keep S1–S6 for debugging, evaluation, replay, SWE-bench, and internal orchestration.
- **External Product API**: expose only task-oriented product endpoints such as:
  - `compile-context`
  - `chat/completions`
  - `patch/generate`
  - `runs`
  - `artifacts`
  - `repositories`

---

## 3. Product Surfaces

### 3.1 Surface A — Context API

Used when the customer already has their own LLM account, model routing, or coding agent loop.

**Agent flow**:
1. Plugin / SDK collects repo metadata, changed files, issue text, stack trace, failing tests, current working set.
2. Plugin calls your **Context API**.
3. Service returns:
   - system prompt additions,
   - developer prompt additions,
   - context snippets,
   - evidence graph references,
   - structured metadata,
   - optional patch plan.
4. Plugin injects the result into the downstream LLM request.
5. Agent continues its own tool loop.

### 3.2 Surface B — Gateway API

Used when the customer wants a single managed endpoint and you monetize both context intelligence and model routing.

**Agent flow**:
1. Plugin / SDK sends repo state + task + desired model policy.
2. Service performs context compilation.
3. Service expands/rewrites the final model request.
4. Gateway routes to configured providers/models.
5. Service returns:
   - streaming tokens or final completion,
   - optional patch block,
   - usage/billing/trace metadata,
   - context compilation stats.

### 3.3 Surface C — Evaluation / Async Run API

Used for heavy jobs:
- full repository indexing,
- benchmark replay,
- batch patch generation,
- verification/test execution,
- organization-level analytics.

---

## 4. Architectural Principles

1. **Separate engine API from product API**.  
   The S1–S6 pipeline remains internal and stable; external APIs stay simple.

2. **Plugins are thin**.  
   Plugins should collect local context and call cloud APIs. They must not duplicate the compiler logic.

3. **Gateway is policy-driven**.  
   Model routing, fallback, BYOK, retention policy, org budget, and compliance are gateway concerns.

4. **Compilation artifacts are first-class**.  
   Query plans, context packages, evidence snippets, patch plans, traces, and verification results should all be persisted as versioned artifacts.

5. **Repo understanding is incremental**.  
   Full scan/ingest should be reusable across many agent turns.

6. **Security defaults to enterprise mode**.  
   Short-lived credentials, encrypted artifacts, tenant isolation, optional zero-retention path, auditable traces.

---

## 5. Recommended Overall System Architecture

## 5.1 High-level logical architecture

```text
+-------------------+        +---------------------------+
| Coding Agent      |        | IDE / CLI / CI           |
| Claude/OpenClaw   |        | GitHub Action / Bot      |
+---------+---------+        +-------------+------------+
          |                                |
          +-------------- Plugin/SDK ------+
                           |
                           v
                +--------------------------+
                | API Edge / Auth / WAF    |
                +------------+-------------+
                             |
      +----------------------+----------------------+
      |                                             |
      v                                             v
+-------------+                           +------------------+
| Context API |                           | Gateway API      |
| Product API |                           | Product API      |
+------+------+                           +--------+---------+
       |                                           |
       v                                           v
+-----------------------------------------------------------+
| Orchestration Layer                                        |
| - request normalization                                    |
| - policy engine                                            |
| - run manager                                              |
| - artifact manager                                         |
| - trace/span manager                                       |
+---------------+----------------------+--------------------+
                |                      |
                v                      v
      +------------------+   +------------------------------+
      | Context Compiler |   | LLM Gateway                  |
      | Engine           |   | - provider adapters          |
      | S1..S4 / S5..S6  |   | - routing/fallback/BYOK      |
      +--------+---------+   | - spend/budget controls      |
               |             +---------------+--------------+
               |                             |
               v                             v
  +----------------------------+     +-----------------------+
  | Artifact / Metadata Store  |     | External LLM Providers|
  | Context Packages / Plans   |     | OpenAI/Anthropic/...  |
  +----------------------------+     +-----------------------+
               |
               v
  +----------------------------+
  | Repo Index / Object Store  |
  | AST / symbol / snapshots   |
  +----------------------------+
```

---

## 5.2 Internal services

### A. API Edge
Responsibilities:
- authentication
- rate limit
- org/project quota
- request signing validation from plugins
- WAF / bot defense
- request size enforcement

### B. Product API Layer
Expose clean public APIs:
- `/v1/context/*`
- `/v1/gateway/*`
- `/v1/runs/*`
- `/v1/repos/*`
- `/v1/artifacts/*`
- `/v1/admin/*`

### C. Orchestration Layer
Responsibilities:
- map external product call to internal stages
- resume partial run from cached artifacts
- determine when to re-scan / re-ingest
- enforce budget and latency policies
- collect traces and metrics

### D. Context Compiler Engine
Wrap existing pipeline modules:
- scan
- ingest
- query compiler
- context compiler
- patch generator
- verifier

### E. LLM Gateway
Responsibilities:
- provider abstraction
- model selection policy
- fallback
- retry
- timeout policy
- spend monitoring
- BYOK
- ZDR / no-training policy flags

### F. Artifact Services
Artifacts to persist:
- repository snapshots
- scan outputs
- episode stores
- query plans
- context packages
- prompt bundles
- patches
- verification logs
- cost & trace summaries

---

## 6. Vercel-style Monorepo Recommendation

Use a monorepo, similar in spirit to the Vercel AI SDK ecosystem.

```text
repo/
  apps/
    console/                  # SaaS console
    api/                      # public API service
    gateway/                  # LLM gateway service
    worker-context/           # compilation workers
    worker-verify/            # sandbox verify workers
    docs/
  packages/
    core-types/               # shared schemas/types
    auth/                     # auth helpers
    tracing/                  # telemetry helpers
    sdk-core/                 # base client runtime
    sdk-js/                   # JS/TS SDK
    sdk-python/               # Python SDK
    provider-openai/
    provider-anthropic/
    provider-openrouter/
    provider-bedrock/
    provider-azure/
    plugin-claude-code/
    plugin-openclaw/
    plugin-cursor/
    plugin-codex/
    prompt-bundles/           # prompt templates, policies
    compiler-adapters/        # wrappers over S1-S6 engine
    gateway-policy/           # routing / budget / retention rules
    repo-sync/                # git snapshot / pack / upload
    security/                 # signing, encryption, policy libs
    eval-harness/             # swe-bench / regression harness
  infrastructure/
    terraform/
    helm/
    k8s/
  docs/
    architecture/
    api/
    plugins/
```

### Why this is the right structure

It gives you:
- one shared type system,
- one auth model,
- many small integration packages,
- clean provider expansion,
- fast plugin iteration,
- a strong open-source / ecosystem story.

---

## 7. External API Design

## 7.1 Product API families

### Family A — Context API

#### `POST /v1/context/compile`
Compile a context package for an agent turn.

**Input**
```json
{
  "project_id": "proj_123",
  "repo": {
    "provider": "github",
    "repo": "org/repo",
    "commit": "abc123",
    "branch": "main"
  },
  "task": {
    "type": "bugfix",
    "problem_statement": "Username validator allows trailing newlines",
    "hints": "Check validators.py",
    "failing_tests": ["tests.validators.test_username_rejects_newline"],
    "passing_tests": ["tests.validators.test_username_accepts_valid"],
    "stack_trace": "..."
  },
  "workspace": {
    "open_files": [
      {"path": "django/contrib/auth/validators.py", "content": "..."}
    ],
    "changed_files": ["django/contrib/auth/validators.py"],
    "cursor_file": "django/contrib/auth/validators.py"
  },
  "options": {
    "max_context_tokens": 12000,
    "include_patch_plan": true,
    "include_raw_snippets": true,
    "latency_tier": "interactive"
  }
}
```

**Output**
```json
{
  "run_id": "run_123",
  "context_id": "ctx_123",
  "prompt_bundle": {
    "system_addendum": "...",
    "developer_addendum": "...",
    "user_addendum": "..."
  },
  "context_package": {
    "primary_symbols": ["UsernameValidator", "validators.py"],
    "evidence_snippets": [{"path": "...", "start": 10, "end": 35, "content": "..."}],
    "reasoning_hints": ["Regex end anchor likely wrong"],
    "patch_plan": ["Replace $ anchor with \\Z"]
  },
  "stats": {
    "estimated_saved_turns": 8,
    "estimated_prompt_tokens": 6120,
    "scan_reused": true,
    "compile_ms": 820
  }
}
```

#### `POST /v1/context/messages`
Return model-ready messages array instead of a generic bundle.

#### `POST /v1/context/patch-plan`
Return a patch plan without calling any downstream LLM.

---

### Family B — Gateway API

#### `POST /v1/gateway/chat/completions`
OpenAI-compatible endpoint with compiler augmentation.

**Input**
```json
{
  "model": "anthropic/claude-sonnet-4.5",
  "messages": [
    {"role": "system", "content": "You are a coding agent."},
    {"role": "user", "content": "Fix the validator bug."}
  ],
  "context": {
    "project_id": "proj_123",
    "repo_ref": {"repo": "org/repo", "commit": "abc123"},
    "task_metadata": {
      "problem_statement": "Username validator allows trailing newlines",
      "failing_tests": ["tests.validators.test_username_rejects_newline"]
    },
    "workspace": {
      "open_files": [
        {"path": "django/contrib/auth/validators.py", "content": "..."}
      ]
    }
  },
  "compiler": {
    "enabled": true,
    "mode": "augment",
    "max_context_tokens": 12000
  },
  "routing": {
    "fallback_models": ["openai/gpt-5.4-mini"],
    "zero_data_retention": true,
    "byok_profile": "enterprise-default"
  },
  "stream": true
}
```

**Output**
- fully OpenAI-compatible stream / non-stream response
- plus response headers or optional metadata block:
  - `x-ccc-run-id`
  - `x-ccc-context-id`
  - `x-ccc-model-provider`
  - `x-ccc-routing-path`
  - `x-ccc-compile-ms`

#### `POST /v1/gateway/responses`
Responses API compatible surface.

#### `POST /v1/gateway/patch`
Single endpoint optimized for coding agents that expect structured patch output.

---

### Family C — Run API

#### `POST /v1/runs`
Create a long-running compilation / patch / verify run.

#### `GET /v1/runs/{run_id}`
Get status.

#### `GET /v1/runs/{run_id}/artifacts`
Get all artifacts generated during the run.

#### `POST /v1/runs/{run_id}/cancel`
Cancel a long job.

---

### Family D — Repository API

#### `POST /v1/repos/register`
Register a repo/project.

#### `POST /v1/repos/{repo_id}/snapshots`
Upload a source snapshot or manifest.

#### `POST /v1/repos/{repo_id}/index`
Trigger scan/ingest.

#### `GET /v1/repos/{repo_id}/index-status`
Check index status.

---

## 7.2 External vs Internal API mapping

| External API | Internal stages |
|---|---|
| `/v1/context/compile` | S1/S2 reuse or run → S3 → S4 |
| `/v1/context/patch-plan` | S1/S2 reuse or run → S3 → S4 → lightweight planner |
| `/v1/gateway/chat/completions` | S1/S2 reuse or run → S3 → S4 → prompt assembly → LLM gateway |
| `/v1/gateway/patch` | S1/S2 reuse or run → S3 → S4 → S5 |
| `/v1/runs/*` | orchestration over S1–S6 |
| `/v1/verify/*` | S6 |

---

## 8. Plugin Architecture

## 8.1 Plugin goals

Plugins should do five things well:
1. detect current coding context,
2. collect minimal local signals,
3. call cloud APIs,
4. inject returned prompt/context into agent flow,
5. surface traces and user controls.

Plugins should **not**:
- reimplement the compiler,
- maintain a second context store,
- hard-code model/provider logic,
- embed business policy.

---

## 8.2 Plugin product lineup

### A. Claude Code plugin
Use the official Claude Code plugin shape.

Capabilities:
- register project
- upload repo metadata / changed files / open files
- request `context/compile`
- optionally call `gateway/chat/completions`
- inject compiled prompts into Claude’s call path
- expose slash commands:
  - `/ccc on`
  - `/ccc off`
  - `/ccc status`
  - `/ccc compile`
  - `/ccc patch`
  - `/ccc gateway`
  - `/ccc policy`

### B. OpenClaw plugin
Because OpenClaw is highly extensible, provide both:
- a memory/context plugin mode,
- a gateway provider mode.

Capabilities:
- intercept task state,
- publish compiler artifacts into OpenClaw runtime state,
- optionally route model invocation via your gateway.

### C. JS/TS SDK
For custom agent frameworks.

### D. Python SDK
For CI bots, internal agent platforms, benchmark scripts.

---

## 8.3 Plugin architecture pattern

```text
+-------------------------+
| Agent Runtime           |
| Claude / OpenClaw       |
+------------+------------+
             |
             v
+-------------------------+
| Local Plugin Runtime    |
| - config                |
| - workspace collector   |
| - prompt injector       |
| - gateway adapter       |
+------------+------------+
             |
             v
+-------------------------+
| Cloud SDK Client        |
| - auth                  |
| - retries               |
| - request signing       |
| - telemetry             |
+------------+------------+
             |
             v
+-------------------------+
| CCC Cloud APIs          |
+-------------------------+
```

---

## 8.4 Plugin operating modes

### Mode 1 — Suggest-only
- plugin calls `context/compile`
- shows returned prompt bundle / patch plan
- user or agent decides whether to inject it

### Mode 2 — Auto-augment
- plugin automatically appends returned prompt content to downstream model call
- best for simple adoption

### Mode 3 — Full gateway
- plugin sends the full request to your gateway
- your cloud controls prompt assembly, routing, fallback, billing, compliance

### Mode 4 — Hybrid enterprise
- context compile on your cloud
- final model call via customer BYOK or private model gateway

---

## 8.5 Plugin package recommendations

```text
packages/
  plugin-core/
  plugin-claude-code/
  plugin-openclaw/
  plugin-shared-hooks/
  sdk-core/
  sdk-js/
  sdk-python/
```

### Shared code in `plugin-core`
- config loading
- org/project key management
- repo snapshot packing
- file filtering
- diff summarization
- prompt merge logic
- streaming metadata handling

### Claude-specific layer
- slash commands
- session hooks
- prompt injection policy
- Claude tool compatibility

### OpenClaw-specific layer
- runtime adapter
- plugin slot registration
- state bridge
- gateway provider bridge

---

## 9. Prompt Assembly Strategy

This is the core product advantage and should be explicit.

### 9.1 Internal prompt layers

1. **Base System Layer**  
   Generic coding behavior rules.

2. **Task Formalization Layer**  
   Generated from QueryPlan / formal goal.

3. **Evidence Layer**  
   Curated snippets, symbols, related episodes, failing tests, stack trace.

4. **Patch Guidance Layer**  
   Constraints about allowed files, patch format, no-regression hints.

5. **Execution Policy Layer**  
   For gateway mode: structured output rules, tool policy, token budget, fallback behavior.

### 9.2 Returned prompt bundle contract

The compiler should not return only “one giant string”. It should return structured blocks:

```json
{
  "prompt_bundle": {
    "system_addendum": "...",
    "developer_addendum": "...",
    "user_addendum": "...",
    "tool_hints": ["..."],
    "patch_constraints": ["..."],
    "evidence_blocks": [
      {"kind": "symbol", "content": "..."},
      {"kind": "test", "content": "..."},
      {"kind": "snippet", "content": "..."}
    ]
  }
}
```

That makes plugins/frameworks easier to support across ecosystems.

---

## 10. Deployment Architecture

## 10.1 Recommended cloud topology

```text
                +------------------------+
                | Global DNS / CDN / WAF |
                +-----------+------------+
                            |
                +-----------v------------+
                | API Gateway / Ingress  |
                +------+-----------------+
                       |
      +----------------+----------------+
      |                                 |
      v                                 v
+-------------+                 +----------------+
| API Service |                 | Gateway Service|
| stateless   |                 | stateless      |
+------+------+                 +--------+-------+
       |                                  |
       v                                  v
+------------------------------------------------+
| Message Bus / Job Queue                        |
+------------+----------------------+------------+
             |                      |
             v                      v
+---------------------+   +----------------------+
| Context Workers     |   | Verify Workers       |
| scan/ingest/query   |   | sandbox/tests        |
| context compilation |   | patch verification   |
+----------+----------+   +----------+-----------+
           |                         |
           v                         v
+----------------------+   +----------------------+
| Metadata DB          |   | Ephemeral Sandbox    |
| Postgres             |   | K8s jobs / Firecracker|
+----------------------+   +----------------------+
           |
           v
+----------------------+   +----------------------+
| Object Store         |   | Vector/Index Store   |
| snapshots/artifacts  |   | optional             |
+----------------------+   +----------------------+
```

---

## 10.2 Recommended infrastructure choices

### Control plane
- API: stateless container services
- DB: Postgres
- Cache: Redis
- Queue: Kafka / NATS / SQS + workers
- Object store: S3-compatible storage

### Data plane
- compilation workers on Kubernetes
- verification workers in stronger isolation
  - Firecracker microVMs or hardened K8s sandboxes
- optional GPU not required for core unless hosting local models

### Multi-region
- active-active API edge
- regional workers for low latency
- artifact storage replicated by policy

---

## 11. Security Architecture

## 11.1 Identity and access

- org-level API keys
- project-scoped tokens
- plugin-issued short-lived session tokens
- optional OAuth for GitHub/GitLab repo linking
- RBAC: org admin / project admin / developer / CI bot / auditor

## 11.2 Data protection

- TLS everywhere
- encryption at rest for DB and object store
- envelope encryption for prompt/context artifacts
- per-tenant encryption domain for enterprise tiers

## 11.3 Tenant isolation

- tenant ID on every artifact and run
- row-level security in metadata DB
- object-store path isolation
- sandbox namespace isolation for verify jobs

## 11.4 Secure handling of source code

Offer three retention tiers:

### Tier 1 — Standard retention
- artifacts stored for replay/debugging
- good for benchmark/product iteration

### Tier 2 — Short retention
- artifacts auto-delete after configurable TTL
- traces retained, raw source minimized

### Tier 3 — Zero-retention mode
- only transient in-memory processing where possible
- no durable storage of source snippets
- persist only billing/metrics/opaque IDs

## 11.5 Gateway policy controls

- provider allow/deny lists
- zero-data-retention routing flag
- disallow prompt-training flag
- BYOK profiles
- region pinning
- max spend per org/project/day/run

## 11.6 Plugin security

- plugin config signed
- least-privilege file collection
- user-visible disclosure of uploaded files/snippets
- local redaction rules before upload
- secrets detection before sending workspace content

---

## 12. Gateway Design

## 12.1 Core gateway responsibilities

The gateway is not just a reverse proxy. It should combine:
- model compatibility layer,
- policy enforcement layer,
- context augmentation layer,
- reliability layer,
- observability layer,
- billing layer.

## 12.2 Provider abstraction

Use a provider adapter interface:

```ts
interface ModelProviderAdapter {
  name: string;
  supportsResponsesApi(): boolean;
  supportsChatCompletions(): boolean;
  supportsToolCalling(): boolean;
  supportsStreaming(): boolean;
  invoke(req: NormalizedLLMRequest): Promise<NormalizedLLMResponse>;
  stream(req: NormalizedLLMRequest): AsyncIterable<NormalizedTokenEvent>;
}
```

## 12.3 Routing policy

Routing decision inputs:
- customer preference
- model capabilities
- task type (patch generation, diagnosis, planning)
- latency target
- price ceiling
- zero-retention requirement
- historical provider health

## 12.4 Gateway modes

- **Pass-through**: only route model calls
- **Augment**: compile context then call model
- **Enforce**: provider, budget, security policy enforced centrally
- **Optimize**: dynamic routing/fallback/caching/BYOK selection

---

## 13. State, Artifacts, and Caching

## 13.1 Cache boundaries

### Reusable artifacts
- repo scan outputs
- episode store / indexes
- symbol graph
- normalized test metadata
- prior verified patches

### Turn-specific artifacts
- query plan
- context package
- prompt bundle
- run trace

### Non-cacheable
- user secrets
- raw credentials
- zero-retention payloads

## 13.2 Cache keys

Suggested cache key components:
- tenant
- repo
- commit SHA
- branch
- file subset hash
- compiler version
- policy version
- task fingerprint

## 13.3 Artifact versioning

Every artifact should record:
- `artifact_id`
- `run_id`
- `compiler_version`
- `policy_version`
- `repo_snapshot_hash`
- `created_at`

This is essential for benchmarking and enterprise auditability.

---

## 14. Recommended Plugin UX

## 14.1 Developer controls

Expose simple controls in each plugin:
- enable/disable compiler
- choose mode: suggest / auto-augment / full gateway
- choose retention policy
- choose model policy
- inspect what files/snippets were uploaded
- inspect estimated turns saved / tokens saved

## 14.2 Default UX

Recommended defaults:
- auto-augment for bug-fix tasks
- suggest-only for large refactors
- gateway mode disabled by default for new users
- explicit opt-in for source upload outside current working set

---

## 15. Observability and Billing

## 15.1 Trace model

Each request produces:
- request trace
- compiler stage timings
- selected context artifacts
- provider routing path
- model token usage
- verification result (if any)

## 15.2 Core product metrics

- compile latency p50/p95
- gateway latency p50/p95
- scan reuse rate
- average context tokens injected
- average agent turns to resolution
- tokens per successful patch
- resolved rate with compiler on/off
- provider fallback rate
- cost per resolved task

## 15.3 Customer-visible analytics

- estimated turns saved
- estimated token savings
- success lift vs baseline
- top repos/projects
- top failure reasons
- top expensive workflows

---

## 16. Recommended Phased Build Plan

## Phase 1 — Foundation
- keep S1–S6 internal engine API
- introduce `/v1/context/compile`
- ship JS/TS SDK and Python SDK
- ship Claude Code plugin
- basic SaaS auth, org/project keys, artifact storage

## Phase 2 — Managed gateway
- launch `/v1/gateway/chat/completions`
- add provider adapters and routing policy
- support BYOK and retention modes
- add OpenClaw plugin

## Phase 3 — Enterprise hardening
- zero-retention mode
- audit export
- private deployment / VPC option
- verify sandbox hardening
- org budgets and routing policy dashboard

## Phase 4 — Platformization
- plugin marketplace
- more agent runtimes
- benchmark/eval API
- automated policy tuning
- context quality analytics and A/B testing

---

## 17. Final Recommendations

### Recommendation 1
Do **not** expose S1–S6 as the main public API. Keep them as internal engine primitives and build product APIs above them.

### Recommendation 2
Ship **two first-class external products** immediately:
- **Context API** for developers who already own the LLM call
- **Gateway API** for customers who want a single managed endpoint and for your monetization model

### Recommendation 3
Adopt a **Vercel-style monorepo + provider adapter + plugin package** strategy. This will make your ecosystem story far stronger than a single monolithic server.

### Recommendation 4
Treat **prompt bundle / context package / run trace** as durable product artifacts. These are not just transient values; they are part of your moat and enterprise control plane.

### Recommendation 5
Make security a product feature, not just an internal concern:
- retention modes,
- BYOK,
- routing policy,
- source disclosure,
- auditability.

---

## 18. Plugin Design Document Summary

### Plugin mission
Deliver high-quality compiled coding context into agent workflows with minimal developer friction.

### Plugin responsibilities
- observe task state
- collect local repo/workspace signals
- call cloud context/gateway APIs
- inject prompt bundles or route model requests
- expose visibility and policy controls

### Plugin non-responsibilities
- heavy indexing logic
- proprietary prompt compilation logic
- model routing policy
- enterprise retention policy logic

### Plugin SKUs
- Claude Code plugin
- OpenClaw plugin
- JS/TS SDK
- Python SDK

### Plugin modes
- suggest-only
- auto-augment
- full gateway
- hybrid enterprise

### Core shared plugin components
- workspace collector
- request signer
- prompt injector
- gateway adapter
- trace renderer
- policy config

---

## 19. What to Build First

If you want the shortest path to market, build in this order:

1. **`/v1/context/compile`**
2. **JS/TS SDK**
3. **Claude Code plugin**
4. **artifact persistence + console trace page**
5. **`/v1/gateway/chat/completions`**
6. **OpenClaw plugin**
7. **verify sandbox**
8. **enterprise security controls**

This gives you both:
- a fast adoption path,
- and a clear upsell path into managed gateway revenue.

