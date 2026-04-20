import { ClaudeCodePlugin } from '@formsy/plugin-claude-code';

/**
 * Example: Basic usage of the Claude Code plugin
 */
async function basicExample() {
  // Initialize plugin with current directory
  const plugin = new ClaudeCodePlugin(process.cwd(), {
    apiKey: process.env.FORMSY_API_KEY || 'your-api-key',
    projectId: 'example-project',
    enabled: true,
    mode: 'auto-augment',
  });

  // Check plugin status
  const status = plugin.getStatus();
  console.log('Plugin Status:', status);

  // Compile context for a bug fix
  try {
    const result = await plugin.compileContext({
      problemStatement: `
        The username validator in our authentication system allows trailing
        newlines in usernames, which should be rejected. The regex pattern
        uses $ anchor instead of \\Z, causing it to match before newlines.
      `,
      openFiles: [
        'src/auth/validators.ts',
        'src/auth/types.ts',
      ],
      cursorFile: 'src/auth/validators.ts',
      failingTests: [
        'tests/auth/validators.test.ts::test_username_rejects_newline',
      ],
      passingTests: [
        'tests/auth/validators.test.ts::test_username_accepts_valid',
      ],
      hints: 'Check the regex pattern in UsernameValidator class',
    });

    console.log('\n=== Context Compilation Result ===');
    console.log('Context ID:', result.contextId);
    console.log('Estimated saved turns:', result.stats.estimatedSavedTurns);
    console.log('Estimated tokens:', result.stats.estimatedPromptTokens);
    console.log('Compile time:', result.stats.compileMs, 'ms');
    console.log('\n=== Compiled Context ===');
    console.log(result.promptBundle);
  } catch (error) {
    console.error('Failed to compile context:', error);
  }
}

/**
 * Example: Using different operating modes
 */
async function modesExample() {
  const plugin = new ClaudeCodePlugin(process.cwd());

  // Suggest mode - show context to user
  plugin.setMode('suggest');
  console.log('Mode set to: suggest');

  // Auto-augment mode - automatically inject context
  plugin.setMode('auto-augment');
  console.log('Mode set to: auto-augment');

  // Gateway mode - route through Formsy gateway
  plugin.setMode('gateway');
  console.log('Mode set to: gateway');
}

/**
 * Example: Enable/disable plugin dynamically
 */
async function toggleExample() {
  const plugin = new ClaudeCodePlugin(process.cwd());

  // Disable plugin
  plugin.disable();
  console.log('Plugin disabled');

  // Enable plugin
  plugin.enable();
  console.log('Plugin enabled');
}

// Run examples
if (require.main === module) {
  basicExample()
    .then(() => console.log('\n✓ Example completed'))
    .catch(error => console.error('Example failed:', error));
}

export { basicExample, modesExample, toggleExample };
