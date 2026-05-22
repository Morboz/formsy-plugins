import { createHash, randomUUID } from 'node:crypto';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const TEST_COMMAND_RE =
  /\b(pytest|tox|nox|unittest|npm\s+test|npm\s+run\s+test|pnpm\s+test|pnpm\s+run\s+test|yarn\s+test|go\s+test|cargo\s+test|mvn\s+test|gradle\s+test|make\s+test)\b/i;
const SECRET_ASSIGNMENT_RE =
  /\b([A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASS|CREDENTIAL)[A-Z0-9_]*)\s*=\s*([^\s;&|]+)/gi;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const LONG_TOKEN_RE = /\b[A-Za-z0-9._~+/=-]{32,}\b/g;

const CONTEXT_SEARCH_TOOLS = new Set([
  'context_search',
  'cc_memory_search',
  'formsy_memory_search',
  'memory_search',
  'session_search',
]);
const CONTEXT_READ_TOOLS = new Set([
  'context_read',
  'cc_memory_read',
  'formsy_memory_read',
  'memory_read',
]);
const FILE_EDIT_TOOLS = new Set(['edit', 'write', 'patch', 'write_file', 'edit_file']);
const SHELL_TOOLS = new Set(['bash', 'shell', 'terminal']);

export interface ObservationSubmitBody {
  client: {
    agent_name: string;
    agent_version: string;
    instance_id: string;
    capabilities: string[];
  };
  reports: TaskReport[];
}

export interface TaskReport {
  schema_version: 'observation.v1';
  report_type: 'agent.task_report';
  report_id: string;
  run_id: string;
  session_id: string;
  task_id: string;
  started_at_ms: number;
  ended_at_ms: number;
  source: {
    kind: 'agent';
    name: string;
    instance_id: string;
  };
  workspace: {
    workspace_id: string;
    repo_id: string;
    revision: string;
  };
  task: {
    task_kind: 'coding';
    case_id: string;
    status: string;
    report_phase: string;
  };
  counters: TaskCounters & {
    model_provider: string;
  };
  observed_behavior: {
    first_test_command_summary: string | null;
    first_test_command_kind: string | null;
    edited_file_hashes: string[];
    edited_file_count: number;
  };
  server_correlation: {
    used_observation_ids: string[];
    last_grounded_accepted_target_hashes: string[];
    server_request_count: number;
  };
  privacy: {
    redaction: 'metrics_and_redacted_summaries';
    contains_prompt: false;
    contains_source: false;
    contains_diff: false;
    contains_shell_output: false;
  };
}

export interface TaskCounters {
  turn_count: number;
  model_turn_count: number;
  context_search_count: number;
  context_read_count: number;
  shell_fallback_count: number;
  test_command_count: number;
  file_edit_count: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

interface TaskState {
  sessionId: string;
  runId: string;
  taskId: string;
  startedAtMs: number;
  model: string;
  firstTaskLabel: string;
  firstTestCommandSummary: string | null;
  firstTestCommandKind: string | null;
  editedFileHashes: Set<string>;
  usedObservationIds: Set<string>;
  groundedTargetHashes: Set<string>;
  counters: TaskCounters;
}

export interface ObservationReporterOptions {
  enabled?: boolean;
  sourceName?: string;
  agentVersion?: string;
  workspaceId?: string;
  repoId?: string;
  revision?: string;
  instanceId?: string;
  submitUrl?: string;
  apiKey?: string;
  spoolDir?: string;
  spoolMaxBytes?: number;
  timeoutMs?: number;
  submit?: (body: ObservationSubmitBody) => Promise<void>;
}

export class FormsyObservationReporter {
  private enabled: boolean;
  private sourceName: string;
  private agentVersion: string;
  private workspaceId: string;
  private repoId: string;
  private revision: string;
  private instanceId: string;
  private submitUrl: string;
  private apiKey: string;
  private spoolDir: string;
  private spoolMaxBytes: number;
  private timeoutMs: number;
  private submitOverride?: (body: ObservationSubmitBody) => Promise<void>;
  private states = new Map<string, TaskState>();

  constructor(options: ObservationReporterOptions = {}) {
    this.enabled = options.enabled ?? truthyEnv('FORMSY_OBSERVABILITY_ENABLED', true);
    this.sourceName = options.sourceName ?? 'opencode';
    this.agentVersion = options.agentVersion ?? process.env.OPENCODE_VERSION ?? '';
    this.workspaceId = options.workspaceId ?? process.env.FORMSY_WORKSPACE_ID ?? 'local';
    this.repoId = options.repoId ?? process.env.FORMSY_REPO_ID ?? path.basename(process.cwd());
    this.revision = options.revision ?? process.env.FORMSY_REVISION ?? '';
    this.instanceId = options.instanceId ?? `${os.hostname()}-${process.pid}`;
    this.submitUrl = options.submitUrl ?? submitUrlFromEnv();
    this.apiKey = options.apiKey ?? process.env.FORMSY_OBSERVABILITY_API_KEY ?? process.env.FORMSY_API_KEY ?? '';
    this.spoolDir =
      options.spoolDir ??
      process.env.FORMSY_OBSERVABILITY_SPOOL_DIR ??
      path.join(os.homedir(), '.opencode', 'formsy-observability');
    this.spoolMaxBytes = options.spoolMaxBytes ?? numberEnv('FORMSY_OBSERVABILITY_SPOOL_MAX_BYTES', 20 * 1024 * 1024);
    this.timeoutMs = options.timeoutMs ?? numberEnv('FORMSY_OBSERVABILITY_TIMEOUT_MS', 2000);
    this.submitOverride = options.submit;
  }

  onChatMessage(input: {
    sessionID?: string;
    model?: string;
    messageText?: string;
  }): void {
    if (!this.enabled) return;
    const state = this.ensureState(input.sessionID, input.model);
    state.counters.turn_count += 1;
    if (!state.firstTaskLabel && input.messageText) {
      state.firstTaskLabel = textSummary(input.messageText, 96);
    }
  }

  onModelRequest(input: {
    sessionID?: string;
    model?: string;
    usage?: Record<string, unknown>;
  }): void {
    if (!this.enabled) return;
    const state = this.ensureState(input.sessionID, input.model);
    state.counters.model_turn_count += 1;
    state.counters.input_tokens += intValue(input.usage, 'input_tokens', 'prompt_tokens', 'total_input_tokens');
    state.counters.output_tokens += intValue(input.usage, 'output_tokens', 'completion_tokens', 'total_output_tokens');
  }

  onToolExecuteBefore(input: {
    sessionID?: string;
    tool: string;
    args?: Record<string, unknown>;
  }): void {
    if (!this.enabled) return;
    const state = this.ensureState(input.sessionID);
    const args = input.args ?? {};

    if (CONTEXT_SEARCH_TOOLS.has(input.tool) || input.tool.includes('search')) {
      state.counters.context_search_count += 1;
    }
    if (CONTEXT_READ_TOOLS.has(input.tool) || input.tool.endsWith('_read')) {
      state.counters.context_read_count += 1;
    }
    if (FILE_EDIT_TOOLS.has(input.tool)) {
      state.counters.file_edit_count += 1;
      this.collectPathHash(state, args);
    }
    if (SHELL_TOOLS.has(input.tool)) {
      const command = stringValue(args.command);
      if (command) {
        state.counters.shell_fallback_count += 1;
      }
      if (TEST_COMMAND_RE.test(command)) {
        state.counters.test_command_count += 1;
        if (!state.firstTestCommandSummary) {
          state.firstTestCommandSummary = textSummary(command, 160);
          state.firstTestCommandKind = testCommandKind(command);
        }
      }
    }
  }

  onToolExecuteAfter(input: {
    sessionID?: string;
    tool: string;
    args?: Record<string, unknown>;
    output?: unknown;
  }): void {
    if (!this.enabled) return;
    const state = this.ensureState(input.sessionID);
    if (FILE_EDIT_TOOLS.has(input.tool)) {
      this.collectPathHash(state, input.args ?? {});
    }
    if (
      CONTEXT_SEARCH_TOOLS.has(input.tool) ||
      CONTEXT_READ_TOOLS.has(input.tool) ||
      input.tool.includes('search') ||
      input.tool.endsWith('_read')
    ) {
      this.collectServerCorrelation(state, input.output);
    }
  }

  async flush(sessionID = 'default', reportPhase = 'partial', status = 'running'): Promise<TaskReport> {
    const state = this.ensureState(sessionID);
    const report = this.buildReport(state, reportPhase, status);
    await this.submitOrSpool(report);
    return report;
  }

  private ensureState(sessionID = 'default', model = ''): TaskState {
    const sid = sessionID || 'default';
    let state = this.states.get(sid);
    if (!state) {
      state = {
        sessionId: sid,
        runId: `opencode_${sid}`,
        taskId: sid,
        startedAtMs: Date.now(),
        model,
        firstTaskLabel: '',
        firstTestCommandSummary: null,
        firstTestCommandKind: null,
        editedFileHashes: new Set(),
        usedObservationIds: new Set(),
        groundedTargetHashes: new Set(),
        counters: {
          turn_count: 0,
          model_turn_count: 0,
          context_search_count: 0,
          context_read_count: 0,
          shell_fallback_count: 0,
          test_command_count: 0,
          file_edit_count: 0,
          input_tokens: 0,
          output_tokens: 0,
          cost_usd: 0,
        },
      };
      this.states.set(sid, state);
    }
    if (model) {
      state.model = model;
    }
    return state;
  }

  private buildReport(state: TaskState, reportPhase: string, status: string): TaskReport {
    return {
      schema_version: 'observation.v1',
      report_type: 'agent.task_report',
      report_id: `rpt_opencode_${randomUUID().replace(/-/g, '')}`,
      run_id: state.runId,
      session_id: state.sessionId,
      task_id: state.taskId,
      started_at_ms: state.startedAtMs,
      ended_at_ms: Date.now(),
      source: {
        kind: 'agent',
        name: this.sourceName,
        instance_id: this.instanceId,
      },
      workspace: {
        workspace_id: this.workspaceId,
        repo_id: this.repoId,
        revision: this.revision,
      },
      task: {
        task_kind: 'coding',
        case_id: state.firstTaskLabel || state.taskId,
        status,
        report_phase: reportPhase,
      },
      counters: {
        ...state.counters,
        model_provider: state.model || 'unknown',
      },
      observed_behavior: {
        first_test_command_summary: state.firstTestCommandSummary,
        first_test_command_kind: state.firstTestCommandKind,
        edited_file_hashes: [...state.editedFileHashes].sort(),
        edited_file_count: state.editedFileHashes.size || state.counters.file_edit_count,
      },
      server_correlation: {
        used_observation_ids: [...state.usedObservationIds].sort(),
        last_grounded_accepted_target_hashes: [...state.groundedTargetHashes].sort(),
        server_request_count: state.counters.model_turn_count,
      },
      privacy: {
        redaction: 'metrics_and_redacted_summaries',
        contains_prompt: false,
        contains_source: false,
        contains_diff: false,
        contains_shell_output: false,
      },
    };
  }

  private async submitOrSpool(report: TaskReport): Promise<void> {
    const body: ObservationSubmitBody = {
      client: {
        agent_name: this.sourceName,
        agent_version: this.agentVersion,
        instance_id: this.instanceId,
        capabilities: ['task_report', 'metrics_and_redacted_summaries', 'opencode_plugin_hooks'],
      },
      reports: [report],
    };

    try {
      if (this.submitOverride) {
        await this.submitOverride(body);
      } else {
        await this.submitHttp(body);
      }
    } catch {
      await this.spool(report);
    }
  }

  private async submitHttp(body: ObservationSubmitBody): Promise<void> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.submitUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Formsy observability returned HTTP ${response.status}`);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  private async spool(report: TaskReport): Promise<void> {
    const day = new Date().toISOString().slice(0, 10);
    const directory = path.join(this.spoolDir, 'task-reports', day);
    await mkdir(directory, { recursive: true });
    const filePath = path.join(directory, `task-reports-${day}.jsonl`);
    await writeFile(filePath, `${JSON.stringify(report)}\n`, { flag: 'a' });
    await trimSpool(this.spoolDir, this.spoolMaxBytes);
  }

  private collectPathHash(state: TaskState, args: Record<string, unknown>): void {
    const filePath =
      stringValue(args.path) ||
      stringValue(args.file_path) ||
      stringValue(args.target_file);
    if (filePath) {
      state.editedFileHashes.add(hashText(filePath));
    }
  }

  private collectServerCorrelation(state: TaskState, output: unknown): void {
    const payload = parseObjectOutput(output);
    if (!payload) return;
    collectCorrelationFromObject(payload, state);
  }
}

function submitUrlFromEnv(): string {
  const base = (
    process.env.FORMSY_OBSERVABILITY_URL ||
    process.env.FORMSY_BASE_URL ||
    'http://127.0.0.1:8000'
  ).replace(/\/+$/, '');
  const endpoint = process.env.FORMSY_OBSERVABILITY_TASK_REPORT_ENDPOINT || '/v1/observations/task_reports';
  return `${base}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
}

function truthyEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function intValue(payload: Record<string, unknown> | undefined, ...keys: string[]): number {
  if (!payload) return 0;
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.max(0, Math.floor(value));
    }
  }
  return 0;
}

function hashText(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function textSummary(value: string, maxChars: number): string {
  let text = value.trim();
  text = text.replace(SECRET_ASSIGNMENT_RE, (_match, key) => `${key}=<redacted>`);
  text = text.replace(BEARER_RE, 'Bearer <redacted>');
  text = text.replace(LONG_TOKEN_RE, '<redacted>');
  text = text.replace(/\s+/g, ' ').trim();
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 3).trimEnd()}...`;
}

function testCommandKind(command: string): string {
  const lowered = command.toLowerCase();
  if (/\b(pytest|unittest|tox|nox)\b/.test(lowered)) return 'python';
  if (/\b(npm|pnpm|yarn)\b/.test(lowered)) return 'javascript';
  if (lowered.includes('go test')) return 'go';
  if (lowered.includes('cargo test')) return 'rust';
  if (lowered.includes('mvn test') || lowered.includes('gradle test')) return 'jvm';
  return 'test';
}

function parseObjectOutput(output: unknown): Record<string, unknown> | null {
  if (typeof output === 'object' && output !== null) {
    if ('metadata' in output && typeof output.metadata === 'object' && output.metadata !== null) {
      return output.metadata as Record<string, unknown>;
    }
    return output as Record<string, unknown>;
  }
  if (typeof output === 'string') {
    try {
      const parsed = JSON.parse(output);
      return parseObjectOutput(parsed);
    } catch {
      return null;
    }
  }
  return null;
}

function collectCorrelationFromObject(payload: Record<string, unknown>, state: TaskState): void {
  for (const key of ['observation_id', 'request_id', 'trace_id']) {
    const value = payload[key];
    if (typeof value === 'string' && value) {
      state.usedObservationIds.add(value);
    }
  }
  for (const key of ['accepted_targets', 'target_paths', 'files']) {
    const values = payload[key];
    if (Array.isArray(values)) {
      for (const value of values) {
        if (typeof value === 'string' && value) {
          state.groundedTargetHashes.add(hashText(value));
        }
      }
    }
  }
  const nested = payload.metadata;
  if (typeof nested === 'object' && nested !== null) {
    collectCorrelationFromObject(nested as Record<string, unknown>, state);
  }
}

async function trimSpool(root: string, maxBytes: number): Promise<void> {
  if (maxBytes <= 0) return;
  const files = await collectJsonlFiles(path.join(root, 'task-reports'));
  const entries = await Promise.all(
    files.map(async (filePath) => ({
      filePath,
      stats: await stat(filePath),
    }))
  );
  entries.sort((left, right) => left.stats.mtimeMs - right.stats.mtimeMs);
  let total = entries.reduce((sum, entry) => sum + entry.stats.size, 0);
  for (const entry of entries) {
    if (total <= maxBytes) break;
    await unlink(entry.filePath);
    total -= entry.stats.size;
  }
}

async function collectJsonlFiles(root: string): Promise<string[]> {
  try {
    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(root, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const entryPath = path.join(root, entry.name);
      if (entry.isDirectory()) {
        files.push(...await collectJsonlFiles(entryPath));
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        files.push(entryPath);
      }
    }
    return files;
  } catch {
    return [];
  }
}
