import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { readdirSync, realpathSync, statSync, type Dirent } from 'node:fs';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DEFAULT_GATEWAY_URL = 'http://localhost:3001';
const COMPILE_PATH = '/api/v1/compile';
const COMPILE_STATUS_PATH = '/api/v1/compile/status';
const SEARCH_PATH = '/api/v1/query';
const READ_PATH = '/api/v1/read';

/**
 * Directories excluded from scanning — mirrors codegraph's DEFAULT_IGNORE_DIRS.
 * Dependency / build / cache / tooling output across supported languages.
 * Test directories (test, tests, spec, specs, __tests__) are NOT excluded.
 */
const IGNORED_DIRECTORIES = new Set([
  // JS / TS — dependency directories
  'node_modules', 'bower_components', 'jspm_packages', 'web_modules',
  '.yarn', '.pnpm-store',
  // JS / TS — framework & bundler build / cache / deploy output
  '.next', '.nuxt', '.svelte-kit', '.turbo', '.vite', '.parcel-cache', '.angular',
  '.docusaurus', 'storybook-static', '.vinxi', '.nitro', 'out-tsc',
  '.vercel', '.netlify', '.wrangler',
  // Build output (common across ecosystems)
  'dist', 'build', 'out', '.output',
  // Test / coverage output (NOT test source dirs)
  'coverage', '.nyc_output',
  // Python
  '__pycache__', '__pypackages__', '.venv', 'venv', '.pixi', '.pdm-build',
  '.mypy_cache', '.pytest_cache', '.ruff_cache', '.tox', '.nox', '.hypothesis',
  '.ipynb_checkpoints', '.eggs',
  // Rust / JVM (Maven, Gradle, Scala)
  'target', '.gradle',
  // .NET
  'obj',
  // Vendored deps (Go, PHP/Composer, Ruby/Bundler)
  'vendor',
  // Swift / iOS
  '.build', 'Pods', 'Carthage', 'DerivedData', '.swiftpm',
  // Dart / Flutter
  '.dart_tool', '.pub-cache',
  // Native (Android NDK, C/C++ deps)
  '.cxx', '.externalNativeBuild', 'vcpkg_installed',
  // Scala tooling
  '.bloop', '.metals',
  // Lua / Luau (LuaRocks)
  'lua_modules', '.luarocks',
  // Delphi / RAD Studio IDE backups
  '__history', '__recovery',
  // Generic cache / tooling
  '.cache', '.claude', '.worktrees', '.codegraph',
]);

/**
 * Max file size (1MB) — skip larger files to avoid OOM on generated/minified blobs.
 */
const MAX_FILE_SIZE = 1024 * 1024;

/** Source extensions matching codegraph's EXTENSION_MAP. */
const SOURCE_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.cxx', '.h', '.hpp', '.hxx',
  '.cs',
  '.dart',
  '.go',
  '.java',
  '.js', '.mjs', '.cjs', '.xsjs', '.xsjslib', '.jsx',
  '.kt', '.kts',
  '.lua', '.luau',
  '.m', '.mm',
  '.pas', '.dpr', '.dpk', '.lpr', '.dfm', '.fmx',
  '.php', '.module', '.install', '.theme', '.inc',
  '.py', '.pyw',
  '.rb', '.rake',
  '.rs',
  '.sc', '.scala',
  '.swift',
  '.ts', '.tsx', '.mts', '.cts',
  '.vue', '.svelte',
  '.liquid', '.twig',
  '.yml', '.yaml', '.xml', '.properties',
]);


function normalizePath(p: string): string {
  return p.split(path.sep).join('/');
}

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
  worktreePaths?: string[];
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
  mode: 'replace' | 'merge';
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
  private lastAsyncError: string;
  private compiledIdentity: { repoId: string; revision: string; querySignature: string } | null;
  private compileRevision: string;
  private lastTerminalTestFailed: boolean;
  private failedTestRecoverySearchUsed: boolean;
  private groundedFiles: string[];
  private explorationClosed: boolean;
  private acceptedTargets: string[];

  /** Track in-progress compiles keyed by `${repoId}:${revision}` to prevent
   *  concurrent compile requests for the same repository, which can cause
   *  write conflicts on the server.  The promise resolves to the same boolean
   *  that ensureMemoryCompiled would return. */
  private compileInProgress: Map<string, Promise<boolean>>;

  constructor() {
    this.gatewayUrl =
      process.env.FORMSY_GATEWAY_URL ||
      process.env.FORMSY_BASE_URL ||
      DEFAULT_GATEWAY_URL;
    this.lastAsyncError = '';
    this.compiledIdentity = null;
    this.compileRevision = '';
    this.lastTerminalTestFailed = false;
    this.failedTestRecoverySearchUsed = false;
    this.groundedFiles = [];
    this.explorationClosed = false;
    this.acceptedTargets = [];
    this.compileInProgress = new Map();
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
    const worktreePaths = await this.listWorktreeDirectories(rootDirectory);

    return {
      repoId,
      revision,
      rootDirectory,
      worktreePaths,
    };
  }

  async compileRepository(
    options: CompileRepositoryOptions
  ): Promise<CompileRepositoryResult> {
    const context = await this.resolveRepositoryContext(options.directory, options);
    const query = '';
    const querySignature = this.querySignature(query);
    const sourceFiles = await this.listSourceFiles(context.rootDirectory, options.include, query, context.worktreePaths);
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
          mode: 'merge',
          removed_paths: [],
          enable_w2: options.enable_w2,
          metadata: {
            compile_profile: 'interactive_context_search',
            source_scope: 'query_bounded',
            query_signature: querySignature || '*',
            function_embeddings: 'deferred',
            sync_function_embeddings: false,
          },
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
    const querySignature = this.querySignature(query);

    // Ensure memory is compiled; check existing compile first
    const compiled = await this.ensureMemoryCompiled({
      repoId: context.repoId,
      revision: context.revision || 'latest',
      query,
      querySignature,
      sessionId: options.session_id,
      directory: options.directory,
      worktreePaths: context.worktreePaths,
    });

    if (!compiled) {
      const errorResponse: Record<string, unknown> = {
        ok: false,
        query,
        repo_id: context.repoId,
        revision: context.revision,
        error: 'Formsy memory compile failed before context_search',
        compile_error: this.lastAsyncError,
        retrieval_status: 'failed',
        recovery_mode: 'degraded_recovery',
        preferred_next_step: 'bounded_shell_inspection',
        allowed_tools: ['terminal', 'read_file', 'search_files'],
        retrieval_feedback:
          'Memory compile failed. Falling back to bounded shell inspection. ' +
          'Use at most one targeted search_files call, then read_file the likely ' +
          'target. Do not repeat identical terminal repro commands; patch or rerun ' +
          'context_search after the server compile issue is fixed.',
      };
      return {
        output: JSON.stringify(errorResponse, null, 2),
        metadata: {
          endpoint: this.memorySearchEndpoint(),
          repoId: context.repoId,
          revision: context.revision,
        },
      };
    }

    const revision = this.compileRevision || context.revision || 'latest';
    const budget = options.budget ?? 4000;
    const metadata: Record<string, unknown> = {
      ...(options.metadata ?? { instance_id: context.repoId }),
    };

    // Add timeout hints
    const timeoutS = Number(process.env.FORMSY_TIMEOUT_S) || 120;
    const serverWaitBudget = Math.max(10, Math.min(timeoutS - 10, 90));
    metadata.query_timeout_s = metadata.query_timeout_s ?? serverWaitBudget;
    metadata.fanout_timeout_s = metadata.fanout_timeout_s ?? serverWaitBudget;

    // Test failure recovery: if last terminal test failed and we have accepted targets,
    // request a grounded search for recovery
    if (
      this.lastTerminalTestFailed &&
      this.explorationClosed &&
      this.acceptedTargets.length > 0
    ) {
      metadata.grounding_phase = 'grounded';
      metadata.grounded_files = [...this.acceptedTargets];
      metadata.test_failure_recovery = true;
      this.failedTestRecoverySearchUsed = true;
    }

    const result = await this.postJson(
      this.memorySearchEndpoint(),
      {
        repo_id: context.repoId,
        query,
        revision,
        budget,
        enable_profiling: options.enable_profiling ?? false,
        profiling_top_n: options.profiling_top_n ?? 20,
        metadata,
        ...(options.identity ? { identity: options.identity } : {}),
      },
      options.session_id
    );
    const data = this.objectData(result.data);

    // Post-process: propagate memory hints into the payload
    const outputData: Record<string, unknown> = { ...data };
    for (const key of [
      'memory_status',
      'memory_freshness',
      'memory_query_hints',
      'memory_test_hints',
    ]) {
      const value = metadata[key];
      if (value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && value.length === 0)) {
        outputData[key] = value;
      }
    }

    // Track grounded files and accepted targets from the search result
    this.updateRetrievalState(outputData, metadata);

    // Extract match files for correlation
    const directMatchFiles = this.extractMatchFiles(outputData.matches);
    const bundlePrimaryFiles = this.extractBundlePrimaryFiles(outputData.bundle);
    const bundleMustEdit = this.extractBundleMustEdit(outputData.bundle);

    // Build FormSy statuses for TUI sidebar consumption
    const formsyStatuses = this.buildContextSearchStatuses(outputData, options.query, directMatchFiles, bundlePrimaryFiles);

    return {
      output: this.searchOutput(outputData),
      metadata: {
        endpoint: this.memorySearchEndpoint(),
        repoId: context.repoId,
        revision: context.revision,
        directMatchFiles,
        bundlePrimaryFiles,
        bundleMustEdit,
        formsy_statuses: formsyStatuses,
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

  async listSourceFiles(directory: string, include?: string[], query?: string, worktreePaths?: string[]): Promise<SourceFile[]> {
    const resolvedWorktreePaths = worktreePaths ?? await this.listWorktreeDirectories(directory);

    // Fast path: use git ls-files (respects .gitignore at all levels)
    const gitFiles = this.getGitSourceFiles(directory);
    let sourceFiles: SourceFile[];
    if (gitFiles) {
      const worktreeSet = new Set(resolvedWorktreePaths.map(p => path.resolve(p)));
      sourceFiles = gitFiles
        .filter(filePath => this.isSourceFile(filePath))
        .map(relativePath => ({
          absolutePath: path.resolve(directory, relativePath),
          relativePath: relativePath.split(path.sep).join('/'),
        }))
        .filter(file => !this.isInWorktree(file.absolutePath, worktreeSet));
    } else {
      // Fallback: filesystem walk for non-git projects
      sourceFiles = [];
      await this.scanDirectoryWalk(directory, directory, sourceFiles, include, resolvedWorktreePaths);
    }

    // Include filtering
    if (include && include.length > 0) {
      sourceFiles = sourceFiles.filter(f => include.some(item => f.relativePath.includes(item)));
    }

    // Sort
    if (query) {
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
      sourceFiles.sort((left, right) => {
        const leftScore = this.queryScore(left.relativePath, terms);
        const rightScore = this.queryScore(right.relativePath, terms);
        if (leftScore !== rightScore) return rightScore - leftScore;
        return left.relativePath.localeCompare(right.relativePath);
      });
    } else {
      sourceFiles.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
    }
    return sourceFiles;
  }

  /**
   * Get all source files visible to git (tracked + untracked but not ignored).
   * Respects .gitignore at all levels. Returns null for non-git projects.
   */
  private getGitSourceFiles(rootDir: string): string[] | null {
    try {
      // Check if project is ignored by a parent git repo
      const gitRoot = execFileSync(
        'git', ['rev-parse', '--show-toplevel'],
        { cwd: rootDir, encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
      ).trim();

      if (path.resolve(gitRoot) !== path.resolve(rootDir)) {
        try {
          execFileSync(
            'git', ['check-ignore', '-q', path.resolve(rootDir)],
            { cwd: rootDir, encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
          );
          return null; // directory is gitignored by parent
        } catch {
          // Not ignored — safe to proceed
        }
      }

      // Tracked files (--recurse-submodules includes submodule files)
      const tracked = execFileSync(
        'git', ['ls-files', '-z', '-c', '--recurse-submodules'],
        { cwd: rootDir, encoding: 'utf-8', timeout: 30000, maxBuffer: 50 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
      );

      // Untracked files
      const untracked = execFileSync(
        'git', ['ls-files', '-z', '-o', '--exclude-standard'],
        { cwd: rootDir, encoding: 'utf-8', timeout: 30000, maxBuffer: 50 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
      );

      const files: string[] = [];
      for (const rel of tracked.split('\0')) {
        if (rel && !IGNORED_DIRECTORIES.has(rel.split('/')[0])) {
          files.push(rel);
        }
      }
      for (const rel of untracked.split('\0')) {
        if (rel && !rel.endsWith('/') && !IGNORED_DIRECTORIES.has(rel.split('/')[0])) {
          files.push(rel);
        }
      }
      return files;
    } catch {
      return null;
    }
  }

  /**
   * Filesystem walk fallback for non-git projects.
   * Filters by IGNORED_DIRECTORIES and SOURCE_EXTENSIONS. Skips symlink cycles.
   */
  private async scanDirectoryWalk(
    rootDirectory: string,
    currentDirectory: string,
    files: SourceFile[],
    include?: string[],
    worktreePaths?: string[]
  ): Promise<void> {
    const worktreeSet = new Set((worktreePaths ?? []).map(p => path.resolve(p)));
    const visitedDirs = new Set<string>();

    const walk = async (dir: string): Promise<void> => {
      // Resolve and detect symlink cycles
      let realDir: string;
      try {
        realDir = realpathSync(dir);
      } catch {
        return; // unresolvable directory
      }
      if (visitedDirs.has(realDir)) return;
      visitedDirs.add(realDir);

      let entries: Dirent[];
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return; // unreadable directory
      }

      for (const entry of entries) {
        // Always skip git internals and our own data directory
        if (entry.name === '.git' || entry.name === '.codegraph') continue;

        const absolutePath = path.join(dir, entry.name);
        const relativePath = normalizePath(path.relative(rootDirectory, absolutePath));

        if (entry.isSymbolicLink()) {
          try {
            const realTarget = realpathSync(absolutePath);
            const st = statSync(realTarget);
            if (st.isDirectory()) {
              if (!IGNORED_DIRECTORIES.has(entry.name)) {
                await walk(absolutePath);
              }
            } else if (st.isFile() && st.size <= MAX_FILE_SIZE && this.isSourceFile(relativePath)) {
              if (!this.isInWorktree(absolutePath, worktreeSet)) {
                files.push({ absolutePath, relativePath });
              }
            }
          } catch {
            // broken symlink — skip
          }
          continue;
        }

        if (entry.isDirectory()) {
          if (IGNORED_DIRECTORIES.has(entry.name)) continue;
          if (!this.isInWorktree(absolutePath, worktreeSet)) {
            await walk(absolutePath);
          }
        } else if (entry.isFile()) {
          if (!this.isSourceFile(relativePath)) continue;
          try {
            const st = statSync(absolutePath);
            if (st.size > MAX_FILE_SIZE) continue;
          } catch {
            continue;
          }
          if (!this.isInWorktree(absolutePath, worktreeSet)) {
            files.push({ absolutePath, relativePath });
          }
        }
      }
    };

    await walk(currentDirectory);
  }

  private isInWorktree(absolutePath: string, worktreeSet: Set<string>): boolean {
    if (worktreeSet.size === 0) return false;
    const resolved = path.resolve(absolutePath);
    for (const wt of worktreeSet) {
      if (resolved === wt || resolved.startsWith(wt + path.sep)) return true;
    }
    return false;
  }

  private isSourceFile(relativePath: string): boolean {
    const ext = path.extname(relativePath).toLowerCase();
    if (SOURCE_EXTENSIONS.has(ext)) return true;
    // Play Framework routes: extensionless `conf/routes`
    if (relativePath === 'conf/routes' || relativePath.endsWith('/conf/routes') || relativePath.endsWith('.routes')) return true;
    return false;
  }

  private detectLanguage(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
      case '.ts':
      case '.tsx':
      case '.mts':
      case '.cts':
        return 'typescript';
      case '.js':
      case '.jsx':
      case '.mjs':
      case '.cjs':
      case '.xsjs':
      case '.xsjslib':
        return 'javascript';
      case '.py':
      case '.pyw':
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
      case '.cxx':
      case '.h':
      case '.hpp':
      case '.hxx':
        return 'cpp';
      case '.cs':
        return 'csharp';
      case '.php':
      case '.module':
      case '.install':
      case '.theme':
      case '.inc':
        return 'php';
      case '.rb':
      case '.rake':
        return 'ruby';
      case '.swift':
        return 'swift';
      case '.kt':
      case '.kts':
        return 'kotlin';
      case '.dart':
        return 'dart';
      case '.sc':
      case '.scala':
        return 'scala';
      case '.lua':
      case '.luau':
        return 'lua';
      case '.m':
      case '.mm':
        return 'objc';
      case '.vue':
        return 'vue';
      case '.svelte':
        return 'svelte';
      case '.pas':
      case '.dpr':
      case '.dpk':
      case '.lpr':
      case '.dfm':
      case '.fmx':
        return 'pascal';
      case '.liquid':
      case '.twig':
      case '.yml':
      case '.yaml':
      case '.xml':
      case '.properties':
        return 'text';
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
    const timeoutMs = (Number(process.env.FORMSY_REQUEST_TIMEOUT_S) || 300) * 1000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      response = await fetch(upstreamUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      const message =
        error instanceof DOMException && error.name === 'AbortError'
          ? `Gateway request timed out after ${timeoutMs / 1000}s`
          : error instanceof Error
            ? error.message
            : 'Failed to reach gateway service';
      throw new Error(`Gateway request failed: ${message}`);
    } finally {
      clearTimeout(timer);
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

  private async listWorktreeDirectories(rootDirectory: string): Promise<string[]> {
    const output = await this.runGit(['worktree', 'list', '--porcelain'], rootDirectory);
    if (!output) return [];

    const resolvedRoot = path.resolve(rootDirectory);
    const paths: string[] = [];
    for (const line of output.split('\n')) {
      if (!line.startsWith('worktree ')) continue;
      const wtPath = line.substring('worktree '.length);
      // Only include worktrees that are subdirectories of rootDirectory (exclude rootDirectory itself)
      // Use path.resolve + path.relative for cross-platform compatibility (Windows git uses / separators)
      const resolved = path.resolve(wtPath);
      if (resolved !== resolvedRoot) {
        const relative = path.relative(resolvedRoot, resolved);
        if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
          paths.push(resolved);
        }
      }
    }
    return paths;
  }

  private memorySearchEndpoint(): string {
    const raw = process.env.FORMSY_MEMORY_SEARCH_ENDPOINT || SEARCH_PATH;
    return raw.startsWith('/') ? raw : `/${raw}`;
  }

  private querySignature(query: string): string {
    const normalized = (query || '').toLowerCase().split(/\s+/).join(' ');
    return createHash('sha256').update(normalized).digest('hex');
  }

  private async ensureMemoryCompiled(options: {
    repoId: string;
    revision: string;
    query: string;
    querySignature: string;
    sessionId?: string;
    directory: string;
    worktreePaths?: string[];
  }): Promise<boolean> {
    const { repoId, revision, query, querySignature, sessionId, directory, worktreePaths } = options;

    // Check if current compiled identity satisfies this query
    if (this.compiledIdentitySatisfies(repoId, revision, querySignature)) {
      return true;
    }

    // Check if server already has a compile that satisfies this query
    const status = await this.compileStatus(repoId, revision, sessionId);
    if (status && this.existingCompileSatisfiesQuery(status, query)) {
      this.compiledIdentity = this.compiledIdentityFromStatus(
        status,
        repoId,
        revision,
        querySignature,
      );
      const statusRevision =
        typeof status.revision === 'string' && status.revision.trim()
          ? status.revision.trim()
          : revision;
      this.compileRevision = statusRevision || revision;
      return true;
    }

    // ── Concurrency guard ──────────────────────────────────────────────
    // Serialize compiles for the same repo+revision by chaining
    // each new request onto the tail of the in-flight promise, so
    // concurrent calls never submit overlapping compile requests.
    const lockKey = `${repoId}:${revision}`;
    const existing = this.compileInProgress.get(lockKey);

    const compilePromise: Promise<boolean> = existing
      ? existing.then(async () => {
          // Re-check after the prior compile finishes — it may have
          // satisfied our query.
          if (this.compiledIdentitySatisfies(repoId, revision, querySignature)) {
            return true;
          }
          // Re-check server status — the prior compile may have
          // uploaded a broader compile that covers our query.
          const serverStatus = await this.compileStatus(repoId, revision, sessionId);
          if (serverStatus && this.existingCompileSatisfiesQuery(serverStatus, query)) {
            this.compiledIdentity = this.compiledIdentityFromStatus(
              serverStatus,
              repoId,
              revision,
              querySignature,
            );
            const statusRevision =
              typeof serverStatus.revision === 'string' && serverStatus.revision.trim()
                ? serverStatus.revision.trim()
                : revision;
            this.compileRevision = statusRevision || revision;
            return true;
          }
          // Compile is still needed — run it now.
          return this._doCompile({
            repoId,
            revision,
            query,
            querySignature,
            directory,
            worktreePaths,
            sessionId,
          });
        })
      : this._doCompile({
          repoId,
          revision,
          query,
          querySignature,
          directory,
          worktreePaths,
          sessionId,
        });

    this.compileInProgress.set(lockKey, compilePromise);

    try {
      return await compilePromise;
    } finally {
      // Only remove the sentinel if it still points to this promise —
      // a chained promise may have replaced us.
      if (this.compileInProgress.get(lockKey) === compilePromise) {
        this.compileInProgress.delete(lockKey);
      }
    }
  }

  /** Execute the actual compile request.  Extracted so concurrency
   *  guard in ensureMemoryCompiled can hold a promise for the result. */
  private async _doCompile(options: {
    repoId: string;
    revision: string;
    query: string;
    querySignature: string;
    sessionId?: string;
    directory: string;
    worktreePaths?: string[];
  }): Promise<boolean> {
    const { repoId, revision, query, querySignature, sessionId, directory, worktreePaths } = options;

    const sourceFiles = await this.listSourceFiles(directory, undefined, query, worktreePaths);
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
      } catch {
        // Skip unreadable files
      }
    }

    this.lastAsyncError = '';
    try {
      await this.postJson<CompileRequestBody>(COMPILE_PATH, {
        repo_id: repoId,
        revision,
        mode: 'merge',
        removed_paths: [],
        metadata: {
          compile_profile: 'interactive_context_search',
          source_scope: 'query_bounded',
          query_signature: querySignature,
          function_embeddings: 'deferred',
          sync_function_embeddings: false,
          instance_id: repoId,
          query,
          source_file_count: files.length,
        },
        files,
      }, sessionId);
    } catch (error) {
      this.lastAsyncError = error instanceof Error ? error.message : String(error);
      return false;
    }

    this.compiledIdentity = { repoId, revision, querySignature };
    this.compileRevision = revision;
    return true;
  }

  private async compileStatus(
    repoId: string,
    revision: string,
    sessionId?: string,
  ): Promise<Record<string, unknown> | null> {
    try {
      const result = await this.postJson(
        COMPILE_STATUS_PATH,
        { repo_id: repoId, revision },
        sessionId,
      );
      const data = this.objectData(result.data);
      return Object.keys(data).length > 0 ? data : null;
    } catch {
      return null;
    }
  }

  private compiledIdentitySatisfies(
    repoId: string,
    revision: string,
    querySignature: string,
  ): boolean {
    if (!this.compiledIdentity) return false;
    const { repoId: cRepo, revision: cRev, querySignature: cQuery } = this.compiledIdentity;
    if (cRepo !== repoId || cRev !== revision) return false;
    return cQuery === '*' || cQuery === querySignature;
  }

  private compiledIdentityFromStatus(
    status: Record<string, unknown>,
    repoId: string,
    revision: string,
    fallbackQuerySignature: string,
  ): { repoId: string; revision: string; querySignature: string } {
    const metadata = typeof status.metadata === 'object' && status.metadata !== null
      ? status.metadata as Record<string, unknown>
      : {};
    const statusRevision = typeof status.revision === 'string' && status.revision.trim()
      ? status.revision.trim()
      : revision;

    if (String(metadata.source_scope || '').trim().toLowerCase() === 'full') {
      return { repoId, revision: statusRevision, querySignature: '*' };
    }
    const profile = String(metadata.compile_profile || '').trim().toLowerCase();
    const parsedFileCount = this.coercePositiveInt(status.parsed_file_count, 0);
    if (profile !== 'interactive_context_search' && parsedFileCount > 260) {
      return { repoId, revision: statusRevision, querySignature: '*' };
    }
    const signature = String(metadata.query_signature || '').trim();
    if (signature) {
      return { repoId, revision: statusRevision, querySignature: signature };
    }
    return { repoId, revision, querySignature: fallbackQuerySignature };
  }

  private existingCompileSatisfiesQuery(
    status: Record<string, unknown>,
    query: string,
  ): boolean {
    const metadata = typeof status.metadata === 'object' && status.metadata !== null
      ? status.metadata as Record<string, unknown>
      : {};

    if (String(metadata.source_scope || '').trim().toLowerCase() === 'full') {
      return true;
    }

    const profile = String(metadata.compile_profile || '').trim().toLowerCase();
    const looksQueryBounded = !!(
      profile === 'interactive_context_search' ||
      metadata.query ||
      metadata.source_file_count
    );
    const parsedFileCount = this.coercePositiveInt(status.parsed_file_count, 0);
    if (!looksQueryBounded && parsedFileCount > 260) {
      return true;
    }

    const signature = String(metadata.query_signature || '').trim();
    if (signature && signature === this.querySignature(query)) {
      return true;
    }

    const previousQuery = String(metadata.query || '').toLowerCase().split(/\s+/).join(' ').trim();
    const currentQuery = (query || '').toLowerCase().split(/\s+/).join(' ').trim();
    return !!(previousQuery && previousQuery === currentQuery);
  }

  private coercePositiveInt(value: unknown, fallback: number): number {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  }

  private queryScore(relativePath: string, terms: string[]): number {
    if (terms.length === 0) return 0;
    const normalized = relativePath.toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (normalized.includes(term)) {
        score += 1;
      }
    }
    return score;
  }

  private updateRetrievalState(
    data: Record<string, unknown>,
    metadata: Record<string, unknown>,
  ): void {
    // Extract grounded files from result
    const groundedFiles = this.coerceStringList(data.grounded_files) ||
      this.coerceStringList(metadata.grounded_files);
    if (groundedFiles.length > 0) {
      this.groundedFiles = groundedFiles;
    }

    // Extract accepted targets
    const acceptedTargets = this.coerceStringList(data.accepted_targets);
    if (acceptedTargets.length > 0) {
      this.acceptedTargets = acceptedTargets;
    }

    // Track exploration closed state
    if (data.exploration_closed === true || data.exploration_closed === 'true') {
      this.explorationClosed = true;
    }

    // If test failure recovery was used and we got a result, reset the flag
    if (metadata.test_failure_recovery) {
      this.lastTerminalTestFailed = false;
    }
  }

  private coerceStringList(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
    }
    if (typeof value === 'string' && value.trim()) {
      return [value.trim()];
    }
    return [];
  }

  private extractMatchFiles(matches: unknown): string[] {
    if (!Array.isArray(matches)) return [];
    const files: string[] = [];
    for (const match of matches) {
      if (typeof match === 'object' && match !== null) {
        const filePath = (match as Record<string, unknown>).file_path ?? (match as Record<string, unknown>).path;
        if (typeof filePath === 'string' && filePath.trim()) {
          files.push(filePath.trim());
        }
      }
    }
    return files;
  }

  private extractBundlePrimaryFiles(bundle: unknown): string[] {
    if (typeof bundle !== 'object' || bundle === null) return [];
    const b = bundle as Record<string, unknown>;
    const editTargets = typeof b.edit_targets === 'object' && b.edit_targets !== null
      ? b.edit_targets as Record<string, unknown>
      : undefined;
    const primary = b.primary_files ?? editTargets?.primary ?? b.bundle_primary_files;
    if (Array.isArray(primary)) {
      return primary
        .filter((item): item is string => typeof item === 'string')
        .map((s) => s.trim())
        .filter(Boolean);
    }
    return [];
  }

  private extractBundleMustEdit(bundle: unknown): string[] {
    if (typeof bundle !== 'object' || bundle === null) return [];
    const b = bundle as Record<string, unknown>;
    const editTargets = typeof b.edit_targets === 'object' && b.edit_targets !== null
      ? b.edit_targets as Record<string, unknown>
      : undefined;
    const mustEdit = b.must_edit_files ?? editTargets?.must_edit;
    if (typeof mustEdit === 'string') return [mustEdit];
    if (Array.isArray(mustEdit)) {
      return mustEdit
        .filter((item): item is string => typeof item === 'string')
        .map((s) => s.trim())
        .filter(Boolean);
    }
    // Also check primary_files with priority=must_edit
    const primaryFiles = b.primary_files;
    if (Array.isArray(primaryFiles)) {
      return primaryFiles
        .filter((item): item is Record<string, unknown> =>
          typeof item === 'object' && item !== null && String(item.priority || '').trim().toLowerCase() === 'must_edit')
        .map((item) => {
          const p = item.path ?? item.file;
          return typeof p === 'string' ? p.trim() : '';
        })
        .filter(Boolean);
    }
    return [];
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

  /**
   * Build FormSy status entries for the TUI sidebar.
   * These are injected into tool result metadata as `formsy_statuses`
   * so the sidebar plugin can render them.
   */
  private buildContextSearchStatuses(
    data: Record<string, unknown>,
    query: string,
    directMatchFiles: string[],
    bundlePrimaryFiles: string[],
  ): Array<{ kind: string; text: string }> {
    const statuses: Array<{ kind: string; text: string }> = [];

    // Top-level fields from server response
    const ok = data.ok;
    const topLevelCoverage = typeof data.coverage === 'string' ? data.coverage : '';
    const acceptedTargets = this.coerceStringList(data.accepted_targets);
    const explorationClosed = data.exploration_closed === true || data.exploration_closed === 'true';

    // Bundle-level fields
    const bundle = typeof data.bundle === 'object' && data.bundle !== null
      ? data.bundle as Record<string, unknown>
      : {};
    const bundleOk = bundle.ok;
    const bundleCoverage = typeof bundle.coverage === 'string' ? bundle.coverage : '';
    const bundleConfidence = typeof bundle.confidence === 'number' ? bundle.confidence : undefined;
    const rootCause = typeof bundle.root_cause_hypothesis === 'object' && bundle.root_cause_hypothesis !== null
      ? bundle.root_cause_hypothesis as Record<string, unknown>
      : undefined;
    const primarySymbol = rootCause && typeof rootCause.primary_symbol === 'string'
      ? rootCause.primary_symbol
      : undefined;
    const primaryFile = rootCause && typeof rootCause.primary_file === 'string'
      ? rootCause.primary_file
      : undefined;

    // Guidance-level fields
    const guidance = typeof data.guidance === 'object' && data.guidance !== null
      ? data.guidance as Record<string, unknown>
      : undefined;
    const canPatchNow = guidance?.can_patch_now === true;
    const groundingConfidence = guidance && typeof guidance.grounding_confidence === 'string'
      ? guidance.grounding_confidence
      : undefined;

    // Failed retrieval
    if (ok === false && bundleOk !== true) {
      const error = typeof data.error === 'string' ? data.error : 'Search failed';
      statuses.push({
        kind: 'formsy.context_ready',
        text: `[FormSy] Context search failed\n${error}`,
      });
      return statuses;
    }

    // Determine effective coverage
    const effectiveCoverage = bundleCoverage || topLevelCoverage;
    const isPoorCoverage = ['poor', 'missing', 'none', 'empty'].includes(effectiveCoverage.toLowerCase());

    // Build context_ready status
    const detailParts: string[] = [];
    if (query) detailParts.push(`query: "${query.substring(0, 50)}${query.length > 50 ? '...' : ''}"`);
    if (directMatchFiles.length) detailParts.push(`direct: ${directMatchFiles.length} file${directMatchFiles.length > 1 ? 's' : ''}`);
    if (bundlePrimaryFiles.length) detailParts.push(`bundle: ${bundlePrimaryFiles.length} primary`);
    if (primarySymbol) detailParts.push(`symbol: ${primarySymbol}`);
    if (bundleConfidence !== undefined) detailParts.push(`confidence: ${(bundleConfidence * 100).toFixed(0)}%`);
    if (groundingConfidence) detailParts.push(`grounding: ${groundingConfidence}`);

    const coverageEmoji = isPoorCoverage ? '⚠' : effectiveCoverage ? '✓' : '';
    const coverageLabel = effectiveCoverage || 'unknown';

    statuses.push({
      kind: 'formsy.context_ready',
      text: `[FormSy] Context Pack ready${coverageEmoji ? ` ${coverageEmoji} ${coverageLabel}` : ''}\n${detailParts.join(' | ')}`,
    });

    // Verified recipe — if we have accepted targets
    if (acceptedTargets.length > 0) {
      statuses.push({
        kind: 'formsy.verified_recipe',
        text: `[FormSy] Verified Recipe\n${acceptedTargets.slice(0, 5).join(', ')}${acceptedTargets.length > 5 ? ` +${acceptedTargets.length - 5} more` : ''}`,
      });
    } else if (primaryFile && canPatchNow) {
      // Even without explicit accepted_targets, if guidance says can_patch_now
      statuses.push({
        kind: 'formsy.verified_recipe',
        text: `[FormSy] Ready to patch\n${primaryFile}`,
      });
    }

    // Finish gate
    if (explorationClosed) {
      statuses.push({
        kind: 'formsy.finish_gate',
        text: `[FormSy] Finish Gate ✓ — Exploration closed, ready to proceed`,
      });
    } else if (canPatchNow && isPoorCoverage === false) {
      statuses.push({
        kind: 'formsy.finish_gate',
        text: `[FormSy] Finish Gate ✓ — Sufficient context to proceed`,
      });
    }

    return statuses;
  }
}
