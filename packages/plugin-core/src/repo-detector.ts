import type { RepoRef } from '@formsy/sdk-core';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

/**
 * Detects repository information from the workspace
 */
export class RepoDetector {
  constructor(private rootDir: string) {}

  /**
   * Detect repository reference
   */
  detect(): RepoRef | null {
    // Try git first
    const gitRepo = this.detectGit();
    if (gitRepo) return gitRepo;

    // Fallback to local
    return {
      provider: 'local',
      repo: this.rootDir,
    };
  }

  /**
   * Detect git repository info
   */
  private detectGit(): RepoRef | null {
    try {
      const gitDir = join(this.rootDir, '.git');
      if (!existsSync(gitDir)) return null;

      // Get remote URL
      const remoteUrl = execSync('git config --get remote.origin.url', {
        cwd: this.rootDir,
        encoding: 'utf-8',
      }).trim();

      // Get current commit
      const commit = execSync('git rev-parse HEAD', {
        cwd: this.rootDir,
        encoding: 'utf-8',
      }).trim();

      // Get current branch
      const branch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: this.rootDir,
        encoding: 'utf-8',
      }).trim();

      // Parse provider and repo from URL
      const { provider, repo } = this.parseGitUrl(remoteUrl);

      return {
        provider,
        repo,
        commit,
        branch,
      };
    } catch {
      return null;
    }
  }

  /**
   * Parse git URL to extract provider and repo
   */
  private parseGitUrl(url: string): { provider: RepoRef['provider']; repo: string } {
    // GitHub SSH: git@github.com:org/repo.git
    // GitHub HTTPS: https://github.com/org/repo.git
    // GitLab: similar patterns

    const patterns = [
      { regex: /github\.com[:/]([^/]+\/[^/.]+)/, provider: 'github' as const },
      { regex: /gitlab\.com[:/]([^/]+\/[^/.]+)/, provider: 'gitlab' as const },
      { regex: /bitbucket\.org[:/]([^/]+\/[^/.]+)/, provider: 'bitbucket' as const },
    ];

    for (const { regex, provider } of patterns) {
      const match = url.match(regex);
      if (match) {
        return {
          provider,
          repo: match[1].replace(/\.git$/, ''),
        };
      }
    }

    return {
      provider: 'local',
      repo: url,
    };
  }
}
