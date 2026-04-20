/**
 * Core types for Formsy SDK
 */

// ============================================================================
// Repository & Workspace Types
// ============================================================================

export interface RepoRef {
  provider: 'github' | 'gitlab' | 'bitbucket' | 'local';
  repo: string;  // e.g., "org/repo"
  commit?: string;
  branch?: string;
}

export interface WorkspaceFile {
  path: string;
  content: string;
}

export interface Workspace {
  open_files?: WorkspaceFile[];
  changed_files?: string[];
  cursor_file?: string;
}

// ============================================================================
// Task Metadata Types
// ============================================================================

export type TaskType = 'bugfix' | 'feature' | 'refactor' | 'test' | 'docs';

export interface TaskMetadata {
  type?: TaskType;
  problem_statement: string;
  hints?: string;
  failing_tests?: string[];
  passing_tests?: string[];
  stack_trace?: string;
  error_codes?: string[];
}

// ============================================================================
// Context API Types
// ============================================================================

export interface ContextCompileRequest {
  project_id: string;
  repo: RepoRef;
  task: TaskMetadata;
  workspace?: Workspace;
  options?: ContextCompileOptions;
}

export interface ContextCompileOptions {
  max_context_tokens?: number;
  include_patch_plan?: boolean;
  include_raw_snippets?: boolean;
  latency_tier?: 'interactive' | 'batch';
}

export interface EvidenceSnippet {
  path: string;
  start: number;
  end: number;
  content: string;
}

export interface ContextPackage {
  primary_symbols: string[];
  evidence_snippets: EvidenceSnippet[];
  reasoning_hints: string[];
  patch_plan?: string[];
}

export interface PromptBundle {
  system_addendum?: string;
  developer_addendum?: string;
  user_addendum?: string;
}

export interface ContextCompileResponse {
  run_id: string;
  context_id: string;
  prompt_bundle: PromptBundle;
  context_package: ContextPackage;
  stats: {
    estimated_saved_turns: number;
    estimated_prompt_tokens: number;
    scan_reused: boolean;
    compile_ms: number;
  };
}

// ============================================================================
// Gateway API Types
// ============================================================================

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GatewayRequest {
  model: string;
  messages: Message[];
  context?: {
    project_id: string;
    repo_ref: RepoRef;
    task_metadata: TaskMetadata;
    workspace?: Workspace;
  };
  compiler?: {
    enabled: boolean;
    mode: 'augment' | 'replace' | 'prepend';
    max_context_tokens?: number;
  };
  routing?: {
    fallback_models?: string[];
    zero_data_retention?: boolean;
    byok_profile?: string;
  };
  stream?: boolean;
}

// ============================================================================
// Client Configuration
// ============================================================================

export interface ClientConfig {
  apiKey: string;
  baseURL?: string;
  projectId?: string;
  timeout?: number;
  retries?: number;
}

// ============================================================================
// Error Types
// ============================================================================

export class FormsyError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode?: number,
    public details?: unknown
  ) {
    super(message);
    this.name = 'FormsyError';
  }
}
