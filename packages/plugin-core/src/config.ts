/**
 * Plugin configuration
 */
export interface PluginConfig {
  /** API key for authentication */
  apiKey: string;

  /** API base URL */
  baseURL?: string;

  /** Project ID */
  projectId?: string;

  /** Enable/disable compiler */
  enabled: boolean;

  /** Operating mode */
  mode: 'suggest' | 'auto-augment' | 'gateway';

  /** Injection mode for auto-augment */
  injectionMode?: 'augment' | 'replace' | 'prepend';

  /** Retention policy */
  retentionPolicy?: 'standard' | 'short' | 'zero';

  /** Model routing policy */
  modelPolicy?: string;

  /** Show what files are uploaded */
  showUploads?: boolean;

  /** Maximum context tokens */
  maxContextTokens?: number;
}

/**
 * Load plugin configuration from environment and config file
 */
export class ConfigLoader {
  private static readonly CONFIG_FILE = '.formsy.json';

  /**
   * Load configuration from environment and file
   */
  static load(overrides?: Partial<PluginConfig>): PluginConfig {
    const envConfig = this.loadFromEnv();
    const fileConfig = this.loadFromFile();

    return {
      ...this.getDefaults(),
      ...fileConfig,
      ...envConfig,
      ...overrides,
    };
  }

  /**
   * Get default configuration
   */
  private static getDefaults(): PluginConfig {
    return {
      apiKey: '',
      enabled: true,
      mode: 'auto-augment',
      injectionMode: 'augment',
      retentionPolicy: 'standard',
      showUploads: true,
      maxContextTokens: 12000,
    };
  }

  /**
   * Load from environment variables
   */
  private static loadFromEnv(): Partial<PluginConfig> {
    const config: Partial<PluginConfig> = {};

    if (process.env.FORMSY_API_KEY) {
      config.apiKey = process.env.FORMSY_API_KEY;
    }

    if (process.env.FORMSY_BASE_URL) {
      config.baseURL = process.env.FORMSY_BASE_URL;
    }

    if (process.env.FORMSY_PROJECT_ID) {
      config.projectId = process.env.FORMSY_PROJECT_ID;
    }

    if (process.env.FORMSY_ENABLED) {
      config.enabled = process.env.FORMSY_ENABLED === 'true';
    }

    return config;
  }

  /**
   * Load from config file
   */
  private static loadFromFile(): Partial<PluginConfig> {
    try {
      const { readFileSync } = require('fs');
      const { join } = require('path');

      const configPath = join(process.cwd(), this.CONFIG_FILE);
      const content = readFileSync(configPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return {};
    }
  }
}
