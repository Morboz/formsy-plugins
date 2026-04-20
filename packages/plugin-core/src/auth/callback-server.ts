import { createServer, type Server } from 'http';
import { URL } from 'url';

export interface CallbackResult {
  code: string;
  state: string;
}

/**
 * Temporary local HTTP server to receive OAuth callback
 * Listens on localhost:8765 for the authorization code
 */
export class CallbackServer {
  private server: Server | null = null;
  private port: number;

  constructor(port = 8765) {
    this.port = port;
  }

  /**
   * Wait for OAuth callback and return the authorization code
   */
  waitForCallback(expectedState: string, timeoutMs = 120000): Promise<CallbackResult> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.stop();
        reject(new Error('Authentication timed out. Please try again.'));
      }, timeoutMs);

      this.server = createServer((req, res) => {
        const url = new URL(req.url || '/', `http://localhost:${this.port}`);

        if (url.pathname !== '/callback') {
          res.writeHead(404);
          res.end('Not found');
          return;
        }

        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const error = url.searchParams.get('error');
        const errorDescription = url.searchParams.get('error_description');

        // Send success/error page to browser
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(error ? this.errorPage(errorDescription || error) : this.successPage());

        clearTimeout(timeout);
        this.stop();

        if (error) {
          reject(new Error(`OAuth error: ${errorDescription || error}`));
          return;
        }

        if (!code || !state) {
          reject(new Error('Missing code or state in callback'));
          return;
        }

        if (state !== expectedState) {
          reject(new Error('State mismatch - possible CSRF attack'));
          return;
        }

        resolve({ code, state });
      });

      this.server.listen(this.port, 'localhost', () => {
        // Server is ready
      });

      this.server.on('error', (err) => {
        clearTimeout(timeout);
        reject(new Error(`Failed to start callback server: ${err.message}`));
      });
    });
  }

  /**
   * Stop the callback server
   */
  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  /**
   * Get the callback URL
   */
  getCallbackUrl(): string {
    return `http://localhost:${this.port}/callback`;
  }

  private successPage(): string {
    return `<!DOCTYPE html>
<html>
<head>
  <title>Formsy - Authentication Successful</title>
  <style>
    body { font-family: -apple-system, sans-serif; display: flex; align-items: center;
           justify-content: center; height: 100vh; margin: 0; background: #f5f5f5; }
    .card { background: white; padding: 40px; border-radius: 12px; text-align: center;
            box-shadow: 0 4px 20px rgba(0,0,0,0.1); max-width: 400px; }
    h1 { color: #22c55e; margin-bottom: 8px; }
    p { color: #666; }
    .icon { font-size: 48px; margin-bottom: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✓</div>
    <h1>Authentication Successful</h1>
    <p>You are now logged in to Formsy.</p>
    <p>You can close this window and return to your editor.</p>
  </div>
</body>
</html>`;
  }

  private errorPage(error: string): string {
    return `<!DOCTYPE html>
<html>
<head>
  <title>Formsy - Authentication Failed</title>
  <style>
    body { font-family: -apple-system, sans-serif; display: flex; align-items: center;
           justify-content: center; height: 100vh; margin: 0; background: #f5f5f5; }
    .card { background: white; padding: 40px; border-radius: 12px; text-align: center;
            box-shadow: 0 4px 20px rgba(0,0,0,0.1); max-width: 400px; }
    h1 { color: #ef4444; margin-bottom: 8px; }
    p { color: #666; }
    .icon { font-size: 48px; margin-bottom: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✗</div>
    <h1>Authentication Failed</h1>
    <p>${error}</p>
    <p>Please close this window and try again.</p>
  </div>
</body>
</html>`;
  }
}
