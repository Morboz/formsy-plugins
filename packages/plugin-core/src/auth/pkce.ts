import { createHash, randomBytes } from 'crypto';

/**
 * PKCE (Proof Key for Code Exchange) utilities
 * Implements RFC 7636 for secure OAuth 2.0 authorization
 */
export class PKCEUtils {
  /**
   * Generate a cryptographically random code verifier
   * RFC 7636: 43-128 characters, URL-safe
   */
  static generateCodeVerifier(): string {
    return randomBytes(64).toString('base64url');
  }

  /**
   * Generate code challenge from verifier using S256 method
   * code_challenge = BASE64URL(SHA256(code_verifier))
   */
  static generateCodeChallenge(verifier: string): string {
    return createHash('sha256').update(verifier).digest('base64url');
  }

  /**
   * Generate a random state parameter for CSRF protection
   */
  static generateState(): string {
    return randomBytes(32).toString('base64url');
  }

  /**
   * Generate a random nonce
   */
  static generateNonce(): string {
    return randomBytes(16).toString('hex');
  }
}

export class PKCEFlow {
  private codeVerifier = PKCEUtils.generateCodeVerifier();
  private state = PKCEUtils.generateState();

  getCodeVerifier(): string {
    return this.codeVerifier;
  }

  getCodeChallenge(): string {
    return PKCEUtils.generateCodeChallenge(this.codeVerifier);
  }

  getState(): string {
    return this.state;
  }
}

export interface AuthorizationURLInput {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  codeChallenge: string;
  state: string;
}

export interface TokenExchangeInput {
  tokenEndpoint: string;
  clientId: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}

export interface RefreshTokenInput {
  tokenEndpoint: string;
  clientId: string;
  refreshToken: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

export function buildAuthorizationURL(input: AuthorizationURLInput): string {
  const url = new URL(input.authorizationEndpoint);

  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('scope', input.scope);
  url.searchParams.set('code_challenge', input.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', input.state);

  return url.toString();
}

export async function exchangeCodeForTokens(
  input: TokenExchangeInput
): Promise<TokenResponse> {
  const response = await fetch(input.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: input.clientId,
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.codeVerifier,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to exchange authorization code: ${response.status}`);
  }

  return response.json();
}

export async function refreshAccessToken(
  input: RefreshTokenInput
): Promise<TokenResponse> {
  const response = await fetch(input.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: input.clientId,
      refresh_token: input.refreshToken,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to refresh access token: ${response.status}`);
  }

  return response.json();
}
