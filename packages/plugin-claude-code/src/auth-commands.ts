import { AuthManager } from '@formsy/plugin-core';

/**
 * Auth commands for Claude Code plugin
 * Provides /formsy login, /formsy logout, /formsy whoami
 */
export class AuthCommands {
  private auth: AuthManager;

  constructor(baseURL: string) {
    this.auth = new AuthManager({ baseURL });
  }

  /**
   * /formsy login
   * Opens browser for OAuth + PKCE flow
   */
  async handleLogin(): Promise<string> {
    const isAuth = await this.auth.isAuthenticated();
    if (isAuth) {
      const user = await this.auth.whoami();
      return [
        `Already logged in as ${user?.email}`,
        `Run /formsy logout first to switch accounts.`,
      ].join('\n');
    }

    try {
      const user = await this.auth.login();
      const org = user.organizations?.[0];

      return [
        `✓ Logged in as ${user.email}`,
        org ? `✓ Organization: ${org.name} (${org.role})` : '',
        `✓ Scopes: context.compile, gateway.invoke`,
        ``,
        `Run /formsy whoami to see your status.`,
      ].filter(Boolean).join('\n');
    } catch (error) {
      return `✗ Login failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /**
   * /formsy logout
   * Revokes tokens and clears local storage
   */
  async handleLogout(): Promise<string> {
    const isAuth = await this.auth.isAuthenticated();
    if (!isAuth) {
      return 'Not logged in.';
    }

    try {
      await this.auth.logout();
      return '✓ Logged out successfully.';
    } catch (error) {
      return `✗ Logout failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /**
   * /formsy whoami
   * Shows current authentication status
   */
  async handleWhoami(): Promise<string> {
    const isAuth = await this.auth.isAuthenticated();
    if (!isAuth) {
      return 'Not logged in. Run /formsy login to authenticate.';
    }

    try {
      const user = await this.auth.whoami();
      if (!user) {
        return 'Session expired. Run /formsy login to re-authenticate.';
      }

      const org = user.organizations?.[0];
      const lines = [
        `Logged in as: ${user.email}`,
        user.name ? `Name: ${user.name}` : '',
        org ? `Organization: ${org.name}` : '',
        org ? `Role: ${org.role}` : '',
        org ? `Plan: ${org.plan}` : '',
      ];

      return lines.filter(Boolean).join('\n');
    } catch (error) {
      return `✗ Failed to fetch user info: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /**
   * Execute auth command
   */
  async execute(subcommand: string): Promise<string> {
    switch (subcommand) {
      case 'login':
        return this.handleLogin();
      case 'logout':
        return this.handleLogout();
      case 'whoami':
        return this.handleWhoami();
      default:
        return [
          'Formsy Auth Commands:',
          '  /formsy login    - Log in to Formsy',
          '  /formsy logout   - Log out of Formsy',
          '  /formsy whoami   - Show current user',
        ].join('\n');
    }
  }
}
