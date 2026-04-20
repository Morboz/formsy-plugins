import {
  PKCEFlow,
  CallbackServer,
  buildAuthorizationURL,
  exchangeCodeForTokens,
  refreshAccessToken,
} from './pkce.js';
import { TokenStorage, StoredTokens } from './token-storage.js';

const FORMSY_CLIENT_ID = 'formsy-cli';
const CALLBACK_PORT = 8765;
const CALLBACK_URI = `http://localhost:${CALLBACK_PORT}/callback`;
const SCOPES = 'context.compile gateway.invoke runs.read profile';

export interface AuthConfig {
  baseURL: string;
}

export interface UserInfo {
  id: string;
  email: string;
  name: string;
  avatar_url?: string;
  organizations: Array<{
    id: string;
    name: string;
    slug: string;
    role: string;
    plan: string;
  }>;
}

/**
 * Auth manager for the Formsy plugin
 * Handles login, logout, token refresh, and user info
 */
export class AuthManager {
  private storage: TokenStorage;
  private baseURL: string;

  constructor(config: AuthConfig) {
    this.storage = new TokenStorage();
    this.baseURL = config.baseURL;
  }

  /**
   * Initiate OAuth + PKCE login flow
   * Opens browser to Formsy console, waits for callback
   */
  async login(): Promise<UserInfo> {
    const pkce = new PKCEFlow();
    const callbackServer = new CallbackServer({
      port: CALLBACK_PORT,
      timeout: 5 * 60 * 1000, // 5 minute timeout
    });

    // Build authorization URL
    const authURL = buildAuthorizationURL({
      authorizationEndpoint: `${this.baseURL}/oauth/authorize`,
      clientId: FORMSY_CLIENT_ID,
      redirectUri: CALLBACK_URI,
      scope: SCOPES,
      codeChallenge: pkce.getCodeChallenge(),
      state: pkce.getState(),
    });

    // Open browser
    console.log('\nOpening browser to Formsy console...');
    console.log(`If browser does not open, visit:\n  ${authURL}\n`);
    await this.openBrowser(authURL);

    // Wait for callback
    const { code } = await callbackServer.waitForCallback(pkce.getState());

    // Exchange code for tokens
    const tokenResponse = await exchangeCodeForTokens({
      tokenEndpoint: `${this.baseURL}/oauth/token`,
      clientId: FORMSY_CLIENT_ID,
      code,
      redirectUri: CALLBACK_URI,
      codeVerifier: pkce.getCodeVerifier(),
    });

    // Store tokens
    const tokens: StoredTokens = {
      access_token: tokenResponse.access_token,
      refresh_token: tokenResponse.refresh_token,
      token_type: tokenResponse.token_type,
      expires_at: Date.now() + tokenResponse.expires_in * 1000,
      scope: tokenResponse.scope,
    };
    await this.storage.store(tokens);

    // Fetch and return user info
    return await this.fetchUserInfo(tokens.access_token);
  }

  /**
   * Logout - revoke tokens and clear storage
   */
  async logout(): Promise<void> {
    const tokens = await this.storage.retrieve();

    if (tokens) {
      // Revoke refresh token on server
      try {
        await fetch(`${this.baseURL}/oauth/revoke`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            token: tokens.refresh_token,
            token_type_hint: 'refresh_token',
          }).toString(),
        });
      } catch {
        // Ignore revocation errors - still clear local tokens
      }
    }

    await this.storage.delete();
  }

  /**
   * Get a valid access token, refreshing if necessary
   */
  async getAccessToken(): Promise<string | null> {
    const tokens = await this.storage.retrieve();
    if (!tokens) return null;

    // Refresh if expired or expiring soon
    if (this.storage.willExpireSoon(tokens)) {
      try {
        const refreshed = await refreshAccessToken({
          tokenEndpoint: `${this.baseURL}/oauth/token`,
          clientId: FORMSY_CLIENT_ID,
          refreshToken: tokens.refresh_token,
        });

        const newTokens: StoredTokens = {
          access_token: refreshed.access_token,
          refresh_token: refreshed.refresh_token,
          token_type: refreshed.token_type,
          expires_at: Date.now() + refreshed.expires_in * 1000,
          scope: refreshed.scope,
        };
        await this.storage.store(newTokens);
        return newTokens.access_token;
      } catch (error) {
        // Refresh failed - user needs to login again
        await this.storage.delete();
        return null;
      }
    }

    return tokens.access_token;
  }

  /**
   * Get current user info
   */
  async whoami(): Promise<UserInfo | null> {
    const token = await this.getAccessToken();
    if (!token) return null;
    return await this.fetchUserInfo(token);
  }

  /**
   * Check if user is authenticated
   */
  async isAuthenticated(): Promise<boolean> {
    const token = await this.getAccessToken();
    return token !== null;
  }

  /**
   * Fetch user info from API
   */
  private async fetchUserInfo(accessToken: string): Promise<UserInfo> {
    const response = await fetch(`${this.baseURL}/v1/users/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch user info: ${response.status}`);
    }

    return await response.json();
  }

  /**
   * Open browser to URL
   */
  private async openBrowser(url: string): Promise<void> {
    const { execSync } = await import('child_process');
    const platform = process.platform;

    try {
      if (platform === 'darwin') {
        execSync(`open "${url}"`);
      } else if (platform === 'linux') {
        execSync(`xdg-open "${url}"`);
      } else if (platform === 'win32') {
        execSync(`start "${url}"`);
      }
    } catch {
      // Browser open failed - user will use the printed URL
    }
  }
}
