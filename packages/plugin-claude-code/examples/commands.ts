import { CommandHandler } from '@formsy/plugin-claude-code';

/**
 * Example: Using slash commands
 */
async function commandsExample() {
  const handler = new CommandHandler({
    rootDir: process.cwd(),
    currentFile: 'src/auth/validators.ts',
    openFiles: ['src/auth/validators.ts', 'src/auth/types.ts'],
  });

  // Check status
  console.log('=== /ccc status ===');
  const status = await handler.execute('status', []);
  console.log(status);

  // Enable plugin
  console.log('\n=== /ccc on ===');
  const onResult = await handler.execute('on', []);
  console.log(onResult);

  // Set mode
  console.log('\n=== /ccc mode auto-augment ===');
  const modeResult = await handler.execute('mode', ['auto-augment']);
  console.log(modeResult);

  // Compile context
  console.log('\n=== /ccc compile ===');
  const compileResult = await handler.execute('compile', [
    'Fix username validator to reject trailing newlines',
  ]);
  console.log(compileResult);

  // Disable plugin
  console.log('\n=== /ccc off ===');
  const offResult = await handler.execute('off', []);
  console.log(offResult);
}

// Run example
if (require.main === module) {
  commandsExample()
    .then(() => console.log('\n✓ Commands example completed'))
    .catch(error => console.error('Commands example failed:', error));
}

export { commandsExample };
