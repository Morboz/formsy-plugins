import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DEFAULT_GATEWAY_URL = 'http://localhost:3001';
const COMPILE_PATH = '/v1/gateway/compile';
const QUERY_PATH = '/v1/gateway/query';

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

interface SourceFile {
  absolutePath: string;
  relativePath: string;
}

interface CompileRequestBody {
  repo_id: string;
  revision?: string;
  enable_w2?: boolean;
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
    this.gatewayUrl = process.env.FORMSY_GATEWAY_URL || DEFAULT_GATEWAY_URL;
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
    const repoId =
      overrides.repo_id ||
      remoteUrl ||
      path.basename(rootDirectory) ||
      path.basename(directory);
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
    let lastData: unknown = { ok: true };
    let lastStatus = 200;

    for (const file of sourceFiles) {
      try {
        const content = await readFile(file.absolutePath, 'utf8');
        const result = await this.postJson<CompileRequestBody>(COMPILE_PATH, {
          repo_id: context.repoId,
          revision: context.revision,
          enable_w2: options.enable_w2,
          files: [
            {
              path: file.relativePath,
              content,
              language: this.detectLanguage(file.relativePath),
              is_test: false,
            },
          ],
        });
        compiledFiles.push(file.relativePath);
        lastData = result.data;
        lastStatus = result.status;
      } catch (error) {
        skippedFiles.push(file.relativePath);
        failures.push({
          path: file.relativePath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      status: lastStatus,
      upstreamUrl,
      data: lastData,
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
    const result = await this.postJson(QUERY_PATH, {
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
    body: TBody
  ): Promise<GatewayResult> {
    const upstreamUrl = new URL(endpointPath, this.gatewayUrl).toString();

    let response: Response;
    try {
      response = await fetch(upstreamUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
}
