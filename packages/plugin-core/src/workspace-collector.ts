import type { Workspace, WorkspaceFile } from '@formsy/sdk-core';
import { readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { glob } from 'glob';

/**
 * Configuration for workspace collection
 */
export interface WorkspaceCollectorConfig {
  /** Root directory of the workspace */
  rootDir: string;

  /** Maximum file size to include (bytes) */
  maxFileSize?: number;

  /** Patterns to exclude */
  excludePatterns?: string[];

  /** Maximum number of files to collect */
  maxFiles?: number;
}

/**
 * Default exclude patterns
 */
const DEFAULT_EXCLUDES = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/coverage/**',
  '**/*.min.js',
  '**/*.map',
  '**/package-lock.json',
  '**/yarn.lock',
  '**/pnpm-lock.yaml',
];

/**
 * Collects workspace context for sending to the API
 */
export class WorkspaceCollector {
  private config: Required<WorkspaceCollectorConfig>;

  constructor(config: WorkspaceCollectorConfig) {
    this.config = {
      maxFileSize: 100 * 1024, // 100KB default
      excludePatterns: DEFAULT_EXCLUDES,
      maxFiles: 50,
      ...config,
    };
  }

  /**
   * Collect open files from the workspace
   */
  async collectOpenFiles(filePaths: string[]): Promise<WorkspaceFile[]> {
    const files: WorkspaceFile[] = [];

    for (const filePath of filePaths) {
      try {
        const fullPath = join(this.config.rootDir, filePath);
        const stat = statSync(fullPath);

        if (stat.size > this.config.maxFileSize) {
          console.warn(`Skipping ${filePath}: exceeds max size`);
          continue;
        }

        const content = readFileSync(fullPath, 'utf-8');
        files.push({
          path: filePath,
          content,
        });
      } catch (error) {
        console.error(`Failed to read ${filePath}:`, error);
      }
    }

    return files;
  }

  /**
   * Detect changed files using git
   */
  async detectChangedFiles(): Promise<string[]> {
    try {
      const { execSync } = await import('child_process');
      const output = execSync('git diff --name-only HEAD', {
        cwd: this.config.rootDir,
        encoding: 'utf-8',
      });

      return output
        .split('\n')
        .filter(line => line.trim())
        .slice(0, this.config.maxFiles);
    } catch (error) {
      console.error('Failed to detect changed files:', error);
      return [];
    }
  }

  /**
   * Find files matching a pattern
   */
  async findFiles(pattern: string): Promise<string[]> {
    const files = await glob(pattern, {
      cwd: this.config.rootDir,
      ignore: this.config.excludePatterns,
      nodir: true,
    });

    return files
      .slice(0, this.config.maxFiles)
      .map(f => relative(this.config.rootDir, f));
  }

  /**
   * Collect full workspace context
   */
  async collect(options?: {
    openFiles?: string[];
    includeChanged?: boolean;
    cursorFile?: string;
  }): Promise<Workspace> {
    const workspace: Workspace = {};

    // Collect open files
    if (options?.openFiles && options.openFiles.length > 0) {
      workspace.open_files = await this.collectOpenFiles(options.openFiles);
    }

    // Detect changed files
    if (options?.includeChanged) {
      workspace.changed_files = await this.detectChangedFiles();
    }

    // Set cursor file
    if (options?.cursorFile) {
      workspace.cursor_file = options.cursorFile;
    }

    return workspace;
  }
}
