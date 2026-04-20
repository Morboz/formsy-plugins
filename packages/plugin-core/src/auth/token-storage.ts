import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

export interface StoredTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;  // Unix timestamp
  scope: string;
  user_email?: string;
  user_name?: string;
  org_id?: string;
  org_slug?: string;
}

/**
 * Secure token storage using OS keychain
 * Falls back to encrypted file storage
 */
export class TokenStorage {
  private static readonly SERVICE = 'formsy-cli';
  private static readonly ACCOUNT = 'auth-tokens';
  private static readonly FALLBACK_DIR = join(homedir(), '.formsy');
  private static readonly FALLBACK_FILE = join(TokenStorage.FALLBACK_DIR, 'tokens.enc');

  /**
   * Store tokens securely
   */
  static async store(tokens: StoredTokens): Promise<void> {
    const data = JSON.stringify(tokens);

    // Try OS keychain first
    if (await this.tryKeychainStore(data)) return;

    // Fallback to encrypted file
    await this.storeEncrypted(data);
  }

  /**
   * Retrieve stored tokens
   */
  static async retrieve(): Promise<StoredTokens | null> {
    // Try OS keychain first
    const keychainData = await this.tryKeychainRetrieve();
    if (keychainData) {
      try {
        return JSON.parse(keychainData);
      } catch {
        return null;
      }
    }

    // Fallback to encrypted file
    return this.retrieveEncrypted();
  }

  /**
   * Delete stored tokens
   */
  static async delete(): Promise<void> {
    await this.tryKeychainDelete();

    if (existsSync(this.FALLBACK_FILE)) {
      unlinkSync(this.FALLBACK_FILE);
    }
  }

  /**
   * Check if tokens are stored
   */
  static async hasTokens(): Promise<boolean> {
    const tokens = await this.retrieve();
    return tokens !== null;
  }

  /**
   * Try to store in OS keychain (macOS)
   */
  private static async tryKeychainStore(data: string): Promise<boolean> {
    if (process.platform !== 'darwin') return false;

    try {
      execSync(
        `security add-generic-password -s "${this.SERVICE}" -a "${this.ACCOUNT}" -w "${data}" -U`,
        { stdio: 'pipe' }
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Try to retrieve from OS keychain (macOS)
   */
  private static async tryKeychainRetrieve(): Promise<string | null> {
    if (process.platform !== 'darwin') return null;

    try {
      const result = execSync(
        `security find-generic-password -s "${this.SERVICE}" -a "${this.ACCOUNT}" -w`,
        { stdio: 'pipe', encoding: 'utf-8' }
      );
      return result.trim();
    } catch {
      return null;
    }
  }

  /**
   * Try to delete from OS keychain (macOS)
   */
  private static async tryKeychainDelete(): Promise<void> {
    if (process.platform !== 'darwin') return;

    try {
      execSync(
        `security delete-generic-password -s "${this.SERVICE}" -a "${this.ACCOUNT}"`,
        { stdio: 'pipe' }
      );
    } catch {
      // Ignore if not found
    }
  }

  /**
   * Store tokens in encrypted file (fallback)
   */
  private static async storeEncrypted(data: string): Promise<void> {
    if (!existsSync(this.FALLBACK_DIR)) {
      mkdirSync(this.FALLBACK_DIR, { recursive: true, mode: 0o700 });
    }

    const key = this.getDerivedKey();
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', key, iv);

    const encrypted = Buffer.concat([
      cipher.update(data, 'utf-8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    const payload = Buffer.concat([iv, authTag, encrypted]);
    writeFileSync(this.FALLBACK_FILE, payload.toString('base64'), { mode: 0o600 });
  }

  /**
   * Retrieve tokens from encrypted file (fallback)
   */
  private static async retrieveEncrypted(): Promise<StoredTokens | null> {
    if (!existsSync(this.FALLBACK_FILE)) return null;

    try {
      const payload = Buffer.from(readFileSync(this.FALLBACK_FILE, 'utf-8'), 'base64');
      const iv = payload.subarray(0, 16);
      const authTag = payload.subarray(16, 32);
      const encrypted = payload.subarray(32);

      const key = this.getDerivedKey();
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);

      const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]);

      return JSON.parse(decrypted.toString('utf-8'));
    } catch {
      return null;
    }
  }

  /**
   * Derive encryption key from machine-specific data
   */
  private static getDerivedKey(): Buffer {
    const machineId = this.getMachineId();
    return scryptSync(machineId, 'formsy-salt', 32);
  }

  /**
   * Get machine-specific identifier for key derivation
   */
  private static getMachineId(): string {
    try {
      if (process.platform === 'darwin') {
        return execSync('ioreg -rd1 -c IOPlatformExpertDevice | grep IOPlatformUUID', {
          encoding: 'utf-8',
          stdio: 'pipe',
        }).trim();
      }
      if (process.platform === 'linux') {
        return readFileSync('/etc/machine-id', 'utf-8').trim();
      }
    } catch {
      // Fallback to hostname
    }
    return require('os').hostname();
  }
}
