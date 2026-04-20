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
