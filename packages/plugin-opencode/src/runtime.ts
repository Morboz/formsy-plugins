import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DEFAULT_GATEWAY_URL = 'http://localhost:3001';
const COMPILE_PATH = '/api/v1/compile';
const SEARCH_PATH = '/api/v1/query';
const READ_PATH = '/api/v1/read';

const IGNORED_DIRECTORIES = new Set([
  '.cache',
  '.git',
  '.next',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
]);

const SOURCE_EXTENSIONS = new Set([
  '.c',
  '.cc',
  '.cpp',
  '.go',
  '.h',
  '.hpp',
  '.java',
  '.js',
  '.jsx',
  '.py',
  '.rs',
  '.ts',
  '.tsx',
]);

const TEST_SEGMENTS = new Set(['__tests__', 'spec', 'specs', 'test', 'tests']);
const REMOTE_REPO_PATTERNS = [
  /github\.com[:/](?<owner>[^/]+)\/(?<repo>[^/.]+)(?:\.git)?$/i,
  /gitlab\.com[:/](?<owner>[^/]+)\/(?<repo>[^/.]+)(?:\.git)?$/i,
  /bitbucket\.org[:/](?<owner>[^/]+)\/(?<repo>[^/.]+)(?:\.git)?$/i,
];

export interface CompileRepositoryOptions {
  directory: string;
  repo_id?: string;
  revision?: string;
  enable_w2?: boolean;
  include?: string[];
}

export interface QueryRepositoryOptions {
  directory: string;
  query: string;
  repo_id?: string;
  revision?: string;
  budget?: number;
  metadata?: Record<string, unknown>;
}

export interface ContextSearchOptions {
  directory: string;
  query: string;
  repo_id?: string;
  revision?: string;
  session_id?: string;
  budget?: number;
  enable_profiling?: boolean;
  profiling_top_n?: number;
  metadata?: Record<string, unknown>;
  identity?: Record<string, unknown>;
}

export interface ContextReadOptions {
  directory: string;
  path: string;
  repo_id?: string;
  revision?: string;
  session_id?: string;
  start_line?: number;
  end_line?: number;
  identity?: Record<string, unknown>;
}

export interface GatewayResult {
  status: number;
  upstreamUrl: string;
  data: unknown;
}

export interface RepositoryContext {
  repoId: string;
  revision?: string;
  rootDirectory: string;
}

export interface CompileRepositoryResult extends GatewayResult {
  repoId: string;
  revision?: string;
  compiledFiles: string[];
  skippedFiles: string[];
  failures: Array<{ path: string; error: string }>;
}

export interface ContextToolResult {
  output: string;
  metadata: Record<string, unknown>;
}

export function normalizeRepoId(
  remoteUrl: string | undefined,
  rootDirectory: string,
  directory: string
): string {
  const trimmed = remoteUrl?.trim();
  if (trimmed) {
    for (const pattern of REMOTE_REPO_PATTERNS) {
      const match = trimmed.match(pattern);
      const owner = match?.groups?.owner;
      const repo = match?.groups?.repo;
      if (owner && repo) {
        return `${owner}__${repo.replace(/\.git$/, '')}`;
      }
    }

    try {
      const url = new URL(trimmed);
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length >= 2) {
        const owner = parts[parts.length - 2];
        const repo = parts[parts.length - 1].replace(/\.git$/, '');
        if (owner && repo) {
          return `${owner}__${repo}`;
        }
      }
    } catch {
      const parts = trimmed.split(/[:/]/).filter(Boolean);
      if (parts.length >= 2) {
        const owner = parts[parts.length - 2];
        const repo = parts[parts.length - 1].replace(/\.git$/, '');
        if (owner && repo) {
          return `${owner}__${repo}`;
        }
      }
    }

    return trimmed.replace(/\.git$/, '');
  }

  return path.basename(rootDirectory) || path.basename(directory) || directory;
}

interface SourceFile {
  absolutePath: string;
  relativePath: string;
}

interface CompileRequestBody {
  repo_id: string;
  revision?: string;
  mode: 'replace';
  removed_paths: string[];
  enable_w2?: boolean;
  metadata: Record<string, unknown>;
  files: Array<{
    path: string;
    content: string;
    language: string;
    is_test: boolean;
  }>;
}

export class OpenCodeRuntime {
  private gatewayUrl: string;

  constructor() {
    this.gatewayUrl =
      process.env.FORMSY_GATEWAY_URL ||
      process.env.FORMSY_BASE_URL ||
      DEFAULT_GATEWAY_URL;
  }

  async resolveRepositoryContext(
    directory: string,
    overrides: { repo_id?: string; revision?: string } = {}
  ): Promise<RepositoryContext> {
    const rootDirectory =
      (await this.runGit(['rev-parse', '--show-toplevel'], directory)) || directory;
    const remoteUrl = await this.runGit(
      ['config', '--get', 'remote.origin.url'],
      rootDirectory
    );
    const repoId = overrides.repo_id || normalizeRepoId(remoteUrl, rootDirectory, directory);
    const revision =
      overrides.revision || (await this.runGit(['rev-parse', 'HEAD'], rootDirectory)) || undefined;

    return {
      repoId,
      revision,
      rootDirectory,
    };
  }

  async compileRepository(
    options: CompileRepositoryOptions
  ): Promise<CompileRepositoryResult> {
    const context = await this.resolveRepositoryContext(options.directory, options);
    const sourceFiles = await this.listSourceFiles(context.rootDirectory, options.include);
    const compiledFiles: string[] = [];
    const skippedFiles: string[] = [];
    const failures: Array<{ path: string; error: string }> = [];
    const upstreamUrl = new URL(COMPILE_PATH, this.gatewayUrl).toString();
    const files: CompileRequestBody['files'] = [];

    for (const file of sourceFiles) {
      try {
        const content = await readFile(file.absolutePath, 'utf8');
        files.push({
          path: file.relativePath,
          content,
          language: this.detectLanguage(file.relativePath),
          is_test: false,
        });
        compiledFiles.push(file.relativePath);
      } catch (error) {
        skippedFiles.push(file.relativePath);
        failures.push({
          path: file.relativePath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const result = files.length > 0
      ? await this.postJson<CompileRequestBody>(COMPILE_PATH, {
          repo_id: context.repoId,
          revision: context.revision,
          mode: 'replace',
          removed_paths: [],
          enable_w2: options.enable_w2,
          metadata: {},
          files,
        })
      : {
          status: 200,
          upstreamUrl,
          data: { ok: true, skipped: 'no source files matched' },
        };

    return {
      status: result.status,
      upstreamUrl,
      data: result.data,
      repoId: context.repoId,
      revision: context.revision,
      compiledFiles,
      skippedFiles,
      failures,
    };
  }

  async queryRepository(
    options: QueryRepositoryOptions
  ): Promise<GatewayResult & { repoId: string; revision?: string }> {
    const context = await this.resolveRepositoryContext(options.directory, options);
    const result = await this.postJson(SEARCH_PATH, {
      repo_id: context.repoId,
      query: options.query,
      revision: context.revision,
      budget: options.budget,
      metadata: options.metadata,
    });

    return {
      ...result,
      repoId: context.repoId,
      revision: context.revision,
    };
  }

  async contextSearch(options: ContextSearchOptions): Promise<ContextToolResult> {
    const query = options.query.trim();
    if (!query) {
      throw new Error('query is required');
    }

    const context = await this.resolveRepositoryContext(options.directory, options);
    const result = await this.postJson(
      this.memorySearchEndpoint(),
      {
        repo_id: context.repoId,
        query,
        revision: context.revision || 'latest',
        budget: options.budget ?? 4000,
        enable_profiling: options.enable_profiling ?? false,
        profiling_top_n: options.profiling_top_n ?? 20,
        metadata: options.metadata ?? { instance_id: context.repoId },
        ...(options.identity ? { identity: options.identity } : {}),
      },
      options.session_id
    );
    const data = this.objectData(result.data);

    return {
      output: this.searchOutput(data),
      metadata: {
        endpoint: this.memorySearchEndpoint(),
        repoId: context.repoId,
        revision: context.revision,
        ...this.correlationMetadata(data),
      },
    };
  }

  async contextRead(options: ContextReadOptions): Promise<ContextToolResult> {
    const requestedPath = options.path.trim();
    if (!requestedPath) {
      throw new Error('path is required');
    }

    const context = await this.resolveRepositoryContext(options.directory, options);
    const body: Record<string, unknown> = {
      repo_id: context.repoId,
      revision: context.revision || 'latest',
      path: requestedPath,
    };
    if (options.start_line !== undefined) {
      body.start_line = options.start_line;
    }
    if (options.end_line !== undefined) {
      body.end_line = options.end_line;
    }
    if (options.identity) {
      body.identity = options.identity;
    }

    const result = await this.postJson(READ_PATH, body, options.session_id);
    const data = this.objectData(result.data);
    const responsePath =
      typeof data.path === 'string' && data.path ? data.path : requestedPath;

    return {
      output: this.readOutput(responsePath, data),
      metadata: {
        endpoint: READ_PATH,
        repoId: context.repoId,
        revision: context.revision,
        ...this.correlationMetadata(data),
        path: responsePath,
      },
    };
  }

  async listSourceFiles(directory: string, include?: string[]): Promise<SourceFile[]> {
    const files: SourceFile[] = [];
    await this.walkDirectory(directory, directory, files, include);
    files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
    return files;
  }

  private async walkDirectory(
    rootDirectory: string,
    currentDirectory: string,
    files: SourceFile[],
    include?: string[]
  ): Promise<void> {
    const entries = await readdir(currentDirectory, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = path.join(currentDirectory, entry.name);
      const relativePath = path.relative(rootDirectory, absolutePath);

      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name) || TEST_SEGMENTS.has(entry.name)) {
          continue;
        }
        await this.walkDirectory(rootDirectory, absolutePath, files, include);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (!this.isSourceFile(relativePath)) {
        continue;
      }

      if (this.isTestFile(relativePath)) {
        continue;
      }

      if (include && include.length > 0 && !include.some((item) => relativePath.includes(item))) {
        continue;
      }

      files.push({
        absolutePath,
        relativePath: relativePath.split(path.sep).join('/'),
      });
    }
  }

  private isSourceFile(relativePath: string): boolean {
    return SOURCE_EXTENSIONS.has(path.extname(relativePath).toLowerCase());
  }

  private isTestFile(relativePath: string): boolean {
    const normalized = relativePath.split(path.sep).join('/');
    const segments = normalized.split('/');
    if (segments.some((segment) => TEST_SEGMENTS.has(segment))) {
      return true;
    }

    const extension = path.extname(normalized);
    const basename = path.basename(normalized, extension).toLowerCase();
    return (
      basename.includes('.test') ||
      basename.includes('.spec') ||
      basename.endsWith('_test') ||
      basename.endsWith('_spec')
    );
  }

  private detectLanguage(filePath: string): string {
    const extension = path.extname(filePath).toLowerCase();
    switch (extension) {
      case '.ts':
      case '.tsx':
        return 'typescript';
      case '.js':
      case '.jsx':
        return 'javascript';
      case '.py':
        return 'python';
      case '.java':
        return 'java';
      case '.go':
        return 'go';
      case '.rs':
        return 'rust';
      case '.c':
      case '.cc':
      case '.cpp':
      case '.h':
      case '.hpp':
        return 'cpp';
      default:
        return 'text';
    }
  }

  private async postJson<TBody extends object>(
    endpointPath: string,
    body: TBody,
    sessionId?: string
  ): Promise<GatewayResult> {
    const upstreamUrl = new URL(endpointPath, this.gatewayUrl).toString();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const apiKey = process.env.FORMSY_API_KEY;
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }
    if (sessionId) {
      headers['X-Session-ID'] = sessionId;
    }

    let response: Response;
    try {
      response = await fetch(upstreamUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to reach gateway service';
      throw new Error(`Gateway request failed: ${message}`);
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch (error) {
      throw new Error(
        `Gateway returned invalid JSON with status ${response.status}`
      );
    }

    if (!response.ok) {
      const message =
        typeof data === 'object' &&
        data !== null &&
        'error' in data &&
        typeof data.error === 'object' &&
        data.error !== null &&
        'message' in data.error &&
        typeof data.error.message === 'string'
          ? data.error.message
          : `Gateway returned status ${response.status}`;
      throw new Error(`${message} (${upstreamUrl})`);
    }

    return {
      status: response.status,
      upstreamUrl,
      data,
    };
  }

  private async runGit(args: string[], cwd: string): Promise<string | undefined> {
    try {
      const { stdout } = await execFileAsync('git', args, { cwd });
      const trimmed = stdout.trim();
      return trimmed || undefined;
    } catch {
      return undefined;
    }
  }

  private memorySearchEndpoint(): string {
    const raw = process.env.FORMSY_MEMORY_SEARCH_ENDPOINT || SEARCH_PATH;
    return raw.startsWith('/') ? raw : `/${raw}`;
  }

  private objectData(data: unknown): Record<string, unknown> {
    return typeof data === 'object' && data !== null ? data as Record<string, unknown> : {};
  }

  private searchOutput(data: Record<string, unknown>): string {
    if (typeof data.extra_context === 'string') {
      return data.extra_context;
    }
    if (typeof data.memory_block === 'string') {
      return data.memory_block;
    }
    return JSON.stringify(data, null, 2);
  }

  private readOutput(filePath: string, data: Record<string, unknown>): string {
    const content = typeof data.content === 'string'
      ? data.content
      : JSON.stringify(data, null, 2);
    const startLine = typeof data.start_line === 'number' ? data.start_line : undefined;
    const endLine = typeof data.end_line === 'number' ? data.end_line : undefined;
    const lineSuffix = startLine !== undefined
      ? `:${startLine}${endLine !== undefined ? `-${endLine}` : ''}`
      : '';
    return `${filePath}${lineSuffix}\n\n${content}`;
  }

  private correlationMetadata(data: Record<string, unknown>): Record<string, string> {
    const metadata: Record<string, string> = {};
    for (const key of ['observation_id', 'request_id', 'trace_id']) {
      const value = data[key];
      if (typeof value === 'string' && value) {
        metadata[key] = value;
      }
    }
    return metadata;
  }
}
