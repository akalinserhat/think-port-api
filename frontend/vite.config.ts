import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const OPTIONAL_PEER_STUBS = new Set([
  '@microsoft/signalr',
  '@capacitor/core',
  '@capacitor-mlkit/barcode-scanning',
]);

let backendChildProc: ChildProcess | null = null;

function resolvePythonBin(): string {
  const venvPy = path.resolve(__dirname, '../.venv/bin/python');
  if (fs.existsSync(venvPy)) {
    return venvPy;
  }
  return '/usr/bin/python3';
}

function ensureFastApiBackendRunning(): void {
  if (backendChildProc && !backendChildProc.killed) {
    return;
  }
  const probe = new net.Socket();
  probe.setTimeout(600);
  probe.once('connect', () => {
    probe.destroy();
  });
  probe.once('error', () => {
    probe.destroy();
    spawnFastApiProcess();
  });
  probe.once('timeout', () => {
    probe.destroy();
    spawnFastApiProcess();
  });
  probe.connect(8000, '127.0.0.1');
}

function spawnFastApiProcess(): void {
  if (backendChildProc && !backendChildProc.killed) {
    return;
  }
  const uvicornBin = path.resolve(__dirname, '../.venv/bin/uvicorn');
  const backendDir = path.resolve(__dirname, '../backend');
  if (!fs.existsSync(uvicornBin) || !fs.existsSync(backendDir)) {
    return;
  }
  try {
    backendChildProc = spawn(
      uvicornBin,
      ['app.main:app', '--host', '0.0.0.0', '--port', '8000', '--reload'],
      {
        cwd: backendDir,
        stdio: 'ignore',
        detached: false,
      }
    );
    backendChildProc.on('exit', () => {
      backendChildProc = null;
    });
  } catch {
    backendChildProc = null;
  }
}

function runSqliteBridge(payload: Record<string, unknown>): { status: number; body: string } {
  const bridgeScript = path.resolve(__dirname, '../backend/app/repositories/sqlite_cli_bridge.py');
  const proc = spawnSync(resolvePythonBin(), [bridgeScript], {
    input: JSON.stringify(payload),
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024,
  });
  if (proc.status !== 0) {
    return {
      status: 500,
      body: JSON.stringify({ detail: proc.stderr || 'SQLite bridge execution error' }),
    };
  }
  const stdout = (proc.stdout || '').trim();
  if (!stdout || stdout === 'null') {
    return {
      status: 404,
      body: JSON.stringify({ detail: 'Sohbet oturumu bulunamadı.' }),
    };
  }
  return { status: 200, body: stdout };
}

function optionalPeerStubPlugin(): Plugin {
  return {
    name: 'akalin-ui-optional-peer-stubs',
    resolveId(id) {
      if (OPTIONAL_PEER_STUBS.has(id)) {
        return `\0virtual:${id}`;
      }
      return null;
    },
    load(id) {
      if (id.startsWith('\0virtual:')) {
        return `
          export const Capacitor = { isNativePlatform: () => false, getPlatform: () => 'web' };
          export const BarcodeScanner = {};
          export class HubConnectionBuilder {
            withUrl() { return this; }
            withAutomaticReconnect() { return this; }
            configureLogging() { return this; }
            build() { return { start: async () => {}, stop: async () => {}, on: () => {}, off: () => {} }; }
          }
          export const LogLevel = { Information: 1, Error: 4, None: 6 };
          export const HttpTransportType = { WebSockets: 1 };
          export default {};
        `;
      }
      return null;
    },
    configureServer(server) {
      ensureFastApiBackendRunning();

      const MODEL_PATHS = new Set([
        '/v1/models',
        '/v1/models/',
        '/v1/v1/models',
        '/v1/v1/models/',
        '/models',
        '/models/',
        '/api/v1/models',
        '/api/v1/models/',
        '/api/models',
        '/api/models/',
        '/api/tags',
        '/api/tags/',
        '/v1beta/models',
        '/v1beta/models/',
        '/v1/v1beta/models',
        '/v1/v1beta/models/',
      ]);

      server.middlewares.use((req, res, next) => {
        const parsedUrl = new URL(req.url || '/', 'http://localhost');
        if (!MODEL_PATHS.has(parsedUrl.pathname)) {
          return next();
        }
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', '*');
        if (req.method === 'OPTIONS') {
          res.statusCode = 204;
          res.end();
          return;
        }
        if (req.method === 'GET' || req.method === 'POST') {
          const result = runSqliteBridge({
            action: 'openai_models_list',
            params: {
              type: parsedUrl.searchParams.get('type') || undefined,
              exclude_image: parsedUrl.searchParams.get('exclude_image') || undefined,
              include_inactive: parsedUrl.searchParams.get('include_inactive') || undefined,
            },
          });
          res.statusCode = result.status;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(result.body);
          return;
        }
        return next();
      });

      server.middlewares.use('/admin/conversations', (req, res) => {
        const parsedUrl = new URL(req.url || '/', 'http://localhost');
        const subPath = parsedUrl.pathname.replace(/^\/+/, '');
        const authHeader = (req.headers['authorization'] as string) || '';
        const xUserId =
          (req.headers['x-user-id'] as string) ||
          parsedUrl.searchParams.get('requester_user_id') ||
          '';

        if (req.method === 'GET' && !subPath) {
          const searchVal =
            parsedUrl.searchParams.get('search') ||
            parsedUrl.searchParams.get('arama') ||
            parsedUrl.searchParams.get('aramaKelimesi') ||
            undefined;
          const sortFieldVal =
            parsedUrl.searchParams.get('sortField') ||
            parsedUrl.searchParams.get('sirala') ||
            undefined;
          const sortOrderVal =
            parsedUrl.searchParams.get('yon') ||
            parsedUrl.searchParams.get('sortOrder') ||
            'desc';

          const result = runSqliteBridge({
            action: 'list',
            authorization: authHeader,
            x_user_id: xUserId,
            params: {
              user_id: parsedUrl.searchParams.get('user_id') || undefined,
              model_id: parsedUrl.searchParams.get('model_id') || undefined,
              source: parsedUrl.searchParams.get('source') || undefined,
              search: searchVal,
              search_field: parsedUrl.searchParams.get('aramaTipi') || undefined,
              is_archived: parsedUrl.searchParams.get('arsivdekiler') || undefined,
              sort_field: sortFieldVal,
              sort_order: sortOrderVal,
              page: parsedUrl.searchParams.get('page') || 1,
              limit:
                parsedUrl.searchParams.get('limit') ||
                parsedUrl.searchParams.get('pageSize') ||
                100,
            },
          });
          res.statusCode = result.status;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(result.body);
          return;
        }

        if (req.method === 'GET' && subPath) {
          const result = runSqliteBridge({
            action: 'detail',
            authorization: authHeader,
            x_user_id: xUserId,
            conversation_id: decodeURIComponent(subPath),
          });
          res.statusCode = result.status;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(result.body);
          return;
        }

        if (req.method === 'DELETE' && subPath) {
          const result = runSqliteBridge({
            action: 'delete',
            authorization: authHeader,
            x_user_id: xUserId,
            conversation_id: decodeURIComponent(subPath),
          });
          res.statusCode = result.status;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(result.body);
          return;
        }

        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          let parsedBody: Record<string, unknown> = {};
          try {
            parsedBody = JSON.parse(body || '{}');
          } catch {}

          if (req.method === 'POST' && subPath === 'record-turn') {
            const result = runSqliteBridge({
              action: 'record_turn',
              authorization: authHeader,
              x_user_id: xUserId,
              payload: {
                ...parsedBody,
                authorization: authHeader,
                x_user_id: xUserId,
              },
            });
            res.statusCode = result.status;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(result.body);
            return;
          }

          if (req.method === 'POST' && !subPath) {
            const result = runSqliteBridge({
              action: 'create',
              authorization: authHeader,
              x_user_id: xUserId,
              body: parsedBody,
            });
            res.statusCode = result.status;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(result.body);
            return;
          }

          if (req.method === 'PATCH' && subPath) {
            const result = runSqliteBridge({
              action: 'update',
              authorization: authHeader,
              x_user_id: xUserId,
              conversation_id: decodeURIComponent(subPath),
              body: parsedBody,
            });
            res.statusCode = result.status;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(result.body);
            return;
          }

          res.statusCode = 405;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ detail: 'Method not allowed' }));
        });
      });

      server.middlewares.use('/admin/proxies/dashboard', (req, res, next) => {
        if (req.method === 'GET') {
          const result = runSqliteBridge({ action: 'pool_dashboard' });
          res.statusCode = result.status;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(result.body);
          return;
        }
        if (req.method === 'POST') {
          let body = '';
          req.on('data', (chunk) => {
            body += chunk;
          });
          req.on('end', () => {
            let parsedBody: Record<string, unknown> = {};
            try {
              parsedBody = JSON.parse(body || '{}');
            } catch {
              parsedBody = {};
            }
            const result = runSqliteBridge({
              action: 'record_pool_event',
              payload: parsedBody,
            });
            res.statusCode = result.status;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(result.body);
          });
          return;
        }
        next();
      });

      server.middlewares.use('/admin/users/auth/login', (req, res, next) => {
        if (req.method !== 'POST') {
          return next();
        }
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          let parsedBody: Record<string, unknown> = {};
          try {
            parsedBody = JSON.parse(body || '{}');
          } catch {}
          const result = runSqliteBridge({
            action: 'system_users_login',
            body: parsedBody,
          });
          let parsedRes: Record<string, unknown> = {};
          try {
            parsedRes = JSON.parse(result.body || '{}');
          } catch {}
          if (parsedRes.authenticated === false) {
            res.statusCode = 401;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ detail: parsedRes.error || 'Giriş başarısız.' }));
            return;
          }
          res.statusCode = result.status;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(result.body);
        });
      });

      server.middlewares.use('/admin/users/system', (req, res) => {
        const parsedUrl = new URL(req.url || '/', 'http://localhost');
        const subPath = parsedUrl.pathname.replace(/^\/+/, '');

        if (req.method === 'GET' && !subPath) {
          const result = runSqliteBridge({ action: 'system_users_list' });
          res.statusCode = result.status;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(result.body);
          return;
        }

        if (req.method === 'DELETE' && subPath) {
          const result = runSqliteBridge({
            action: 'system_users_delete',
            user_id: decodeURIComponent(subPath),
          });
          let parsedRes: Record<string, unknown> = {};
          try {
            parsedRes = JSON.parse(result.body || '{}');
          } catch {}
          if (parsedRes.error) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ detail: parsedRes.error }));
            return;
          }
          res.statusCode = result.status;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(result.body);
          return;
        }

        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          let parsedBody: Record<string, unknown> = {};
          try {
            parsedBody = JSON.parse(body || '{}');
          } catch {}

          if (req.method === 'POST' && !subPath) {
            const result = runSqliteBridge({
              action: 'system_users_create',
              body: parsedBody,
            });
            let parsedRes: Record<string, unknown> = {};
            try {
              parsedRes = JSON.parse(result.body || '{}');
            } catch {}
            if (parsedRes.error) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({ detail: parsedRes.error }));
              return;
            }
            res.statusCode = result.status;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(result.body);
            return;
          }

          if (req.method === 'PATCH' && subPath.endsWith('/toggle-status')) {
            const userId = decodeURIComponent(subPath.replace(/\/toggle-status$/, ''));
            const result = runSqliteBridge({
              action: 'system_users_toggle',
              user_id: userId,
            });
            res.statusCode = result.status;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(result.body);
            return;
          }

          if (req.method === 'PATCH' && subPath) {
            const result = runSqliteBridge({
              action: 'system_users_update',
              user_id: decodeURIComponent(subPath),
              body: parsedBody,
            });
            let parsedRes: Record<string, unknown> = {};
            try {
              parsedRes = JSON.parse(result.body || '{}');
            } catch {}
            if (parsedRes.error) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({ detail: parsedRes.error }));
              return;
            }
            res.statusCode = result.status;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(result.body);
            return;
          }

          res.statusCode = 405;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ detail: 'Method not allowed' }));
        });
      });

      server.middlewares.use('/admin/sqlite-state', (req, res, next) => {
        if (req.method !== 'GET') {
          return next();
        }
        const result = runSqliteBridge({ action: 'sqlite_state_overlay' });
        res.statusCode = result.status;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(result.body);
      });

      server.middlewares.use('/admin/users', (req, res, next) => {
        const parsedUrl = new URL(req.url || '/', 'http://localhost');
        const subPath = parsedUrl.pathname.replace(/^\/+/, '');
        if (subPath.startsWith('system') || subPath.startsWith('auth')) {
          return next();
        }

        if (req.method === 'GET' && !subPath) {
          const result = runSqliteBridge({ action: 'users_list' });
          res.statusCode = result.status;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(result.body);
          return;
        }

        const tokenListMatch = subPath.match(/^([^/]+)\/tokens$/);
        const tokenItemMatch = subPath.match(/^([^/]+)\/tokens\/([^/]+)$/);

        if (req.method === 'GET' && tokenListMatch) {
          const userId = decodeURIComponent(tokenListMatch[1]);
          const result = runSqliteBridge({
            action: 'user_tokens_list',
            user_id: userId,
          });
          res.statusCode = result.status;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(result.body);
          return;
        }

        if (req.method === 'DELETE' && tokenItemMatch) {
          const userId = decodeURIComponent(tokenItemMatch[1]);
          const allocId = decodeURIComponent(tokenItemMatch[2]);
          const result = runSqliteBridge({
            action: 'user_tokens_delete',
            user_id: userId,
            allocation_id: allocId,
          });
          let parsedRes: Record<string, unknown> = {};
          try {
            parsedRes = JSON.parse(result.body || '{}');
          } catch {}
          if (parsedRes.error) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ detail: parsedRes.error }));
            return;
          }
          res.statusCode = result.status;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(result.body);
          return;
        }

        if (req.method === 'DELETE' && subPath) {
          const result = runSqliteBridge({
            action: 'system_users_delete',
            user_id: decodeURIComponent(subPath),
          });
          let parsedRes: Record<string, unknown> = {};
          try {
            parsedRes = JSON.parse(result.body || '{}');
          } catch {}
          if (parsedRes.error) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ detail: parsedRes.error }));
            return;
          }
          res.statusCode = result.status;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(result.body);
          return;
        }

        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          let parsedBody: Record<string, unknown> = {};
          try {
            parsedBody = JSON.parse(body || '{}');
          } catch {}

          if (req.method === 'POST' && tokenListMatch) {
            const userId = decodeURIComponent(tokenListMatch[1]);
            const result = runSqliteBridge({
              action: 'user_tokens_create',
              user_id: userId,
              body: parsedBody,
            });
            let parsedRes: Record<string, unknown> = {};
            try {
              parsedRes = JSON.parse(result.body || '{}');
            } catch {}
            if (parsedRes.error) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({ detail: parsedRes.error }));
              return;
            }
            res.statusCode = result.status;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(result.body);
            return;
          }

          if (req.method === 'PATCH' && tokenItemMatch) {
            const userId = decodeURIComponent(tokenItemMatch[1]);
            const allocId = decodeURIComponent(tokenItemMatch[2]);
            const result = runSqliteBridge({
              action: 'user_tokens_update',
              user_id: userId,
              allocation_id: allocId,
              body: parsedBody,
            });
            let parsedRes: Record<string, unknown> = {};
            try {
              parsedRes = JSON.parse(result.body || '{}');
            } catch {}
            if (parsedRes.error) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({ detail: parsedRes.error }));
              return;
            }
            res.statusCode = result.status;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(result.body);
            return;
          }

          if (req.method === 'POST' && !subPath) {
            const result = runSqliteBridge({
              action: 'users_create',
              body: parsedBody,
            });
            let parsedRes: Record<string, unknown> = {};
            try {
              parsedRes = JSON.parse(result.body || '{}');
            } catch {}
            if (parsedRes.error) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({ detail: parsedRes.error }));
              return;
            }
            res.statusCode = result.status;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(result.body);
            return;
          }

          if (req.method === 'PATCH' && subPath.endsWith('/toggle-status')) {
            const userId = decodeURIComponent(subPath.replace(/\/toggle-status$/, ''));
            const result = runSqliteBridge({
              action: 'users_toggle',
              user_id: userId,
            });
            res.statusCode = result.status;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(result.body);
            return;
          }

          if (req.method === 'PATCH' && subPath) {
            const result = runSqliteBridge({
              action: 'system_users_update',
              user_id: decodeURIComponent(subPath),
              body: parsedBody,
            });
            let parsedRes: Record<string, unknown> = {};
            try {
              parsedRes = JSON.parse(result.body || '{}');
            } catch {}
            if (parsedRes.error) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({ detail: parsedRes.error }));
              return;
            }
            res.statusCode = result.status;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(result.body);
            return;
          }

          res.statusCode = 405;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ detail: 'Method not allowed' }));
        });
      });

      server.middlewares.use('/admin/api-keys', (req, res) => {
        const parsedUrl = new URL(req.url || '/', 'http://localhost');
        const subPath = parsedUrl.pathname.replace(/^\/+/, '');

        if (req.method === 'GET' && !subPath) {
          const result = runSqliteBridge({ action: 'api_keys_list' });
          res.statusCode = result.status;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(result.body);
          return;
        }

        if (req.method === 'DELETE' && subPath) {
          const result = runSqliteBridge({
            action: 'api_keys_revoke',
            key_id: decodeURIComponent(subPath),
          });
          res.statusCode = result.status;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(result.body);
          return;
        }

        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          let parsedBody: Record<string, unknown> = {};
          try {
            parsedBody = JSON.parse(body || '{}');
          } catch {}

          if (req.method === 'POST' && !subPath) {
            const result = runSqliteBridge({
              action: 'api_keys_create',
              body: parsedBody,
            });
            res.statusCode = result.status;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(result.body);
            return;
          }

          res.statusCode = 405;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ detail: 'Method not allowed' }));
        });
      });

      server.middlewares.use('/admin/roles', (req, res) => {
        const parsedUrl = new URL(req.url || '/', 'http://localhost');
        const subPath = parsedUrl.pathname.replace(/^\/+/, '');

        if (req.method === 'GET' && !subPath) {
          const result = runSqliteBridge({ action: 'roles_list' });
          res.statusCode = result.status;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(result.body);
          return;
        }

        if (req.method === 'DELETE' && subPath) {
          const result = runSqliteBridge({
            action: 'roles_delete',
            role_id: decodeURIComponent(subPath),
          });
          let parsedRes: Record<string, unknown> = {};
          try {
            parsedRes = JSON.parse(result.body || '{}');
          } catch {}
          if (parsedRes.error) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ detail: parsedRes.error }));
            return;
          }
          res.statusCode = result.status;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(result.body);
          return;
        }

        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          let parsedBody: Record<string, unknown> = {};
          try {
            parsedBody = JSON.parse(body || '{}');
          } catch {}

          if (req.method === 'POST' && !subPath) {
            const result = runSqliteBridge({
              action: 'roles_create',
              body: parsedBody,
            });
            let parsedRes: Record<string, unknown> = {};
            try {
              parsedRes = JSON.parse(result.body || '{}');
            } catch {}
            if (parsedRes.error) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({ detail: parsedRes.error }));
              return;
            }
            res.statusCode = result.status;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(result.body);
            return;
          }

          if (req.method === 'PATCH' && subPath) {
            const result = runSqliteBridge({
              action: 'roles_update',
              role_id: decodeURIComponent(subPath),
              body: parsedBody,
            });
            let parsedRes: Record<string, unknown> = {};
            try {
              parsedRes = JSON.parse(result.body || '{}');
            } catch {}
            if (parsedRes.error) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({ detail: parsedRes.error }));
              return;
            }
            res.statusCode = result.status;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(result.body);
            return;
          }

          res.statusCode = 405;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ detail: 'Method not allowed' }));
        });
      });

      server.middlewares.use('/admin/smtp', (req, res) => {
        const parsedUrl = new URL(req.url || '/', 'http://localhost');
        const subPath = parsedUrl.pathname.replace(/^\/+/, '');

        if (req.method === 'GET' && !subPath) {
          const result = runSqliteBridge({ action: 'smtp_get' });
          res.statusCode = result.status;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(result.body);
          return;
        }

        if (req.method === 'GET' && subPath === 'logs') {
          const result = runSqliteBridge({ action: 'smtp_reset_logs_list', limit: 50 });
          res.statusCode = result.status;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(result.body);
          return;
        }

        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          let parsedBody: Record<string, unknown> = {};
          try {
            parsedBody = JSON.parse(body || '{}');
          } catch {}

          if ((req.method === 'PUT' || req.method === 'PATCH' || req.method === 'POST') && !subPath) {
            const result = runSqliteBridge({
              action: 'smtp_update',
              body: parsedBody,
            });
            res.statusCode = result.status;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(result.body);
            return;
          }

          if (req.method === 'POST' && subPath === 'test') {
            const result = runSqliteBridge({
              action: 'smtp_test',
              body: parsedBody,
            });
            res.statusCode = result.status;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(result.body);
            return;
          }

          if (req.method === 'POST' && subPath === 'send-password-reset') {
            const result = runSqliteBridge({
              action: 'smtp_send_password_reset',
              body: parsedBody,
            });
            let parsedRes: Record<string, unknown> = {};
            try {
              parsedRes = JSON.parse(result.body || '{}');
            } catch {}
            if (parsedRes.error) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({ detail: parsedRes.error }));
              return;
            }
            res.statusCode = result.status;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(result.body);
            return;
          }

          if (req.method === 'POST' && subPath === 'confirm-password-reset') {
            const result = runSqliteBridge({
              action: 'smtp_confirm_password_reset',
              body: parsedBody,
            });
            let parsedRes: Record<string, unknown> = {};
            try {
              parsedRes = JSON.parse(result.body || '{}');
            } catch {}
            if (parsedRes.error) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({ detail: parsedRes.error }));
              return;
            }
            res.statusCode = result.status;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(result.body);
            return;
          }

          res.statusCode = 405;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ detail: 'Method not allowed' }));
        });
      });

      server.middlewares.use((req, res, next) => {
        if (req.url && req.url.includes('@akalin/ui')) {
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        }
        next();
      });

      server.middlewares.use('/admin/logs/client-error', (req, res, next) => {
        if (req.method !== 'POST') {
          return next();
        }
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          try {
            const payload = JSON.parse(body || '{}');
            const logDir = path.resolve(__dirname, '../backend/logs');
            fs.mkdirSync(logDir, { recursive: true });
            const ts = payload.ts || new Date().toISOString();
            const entry = [
              `=== ${ts} | ${payload.type || 'FRONTEND_ERROR'} | ${payload.href || ''} ===`,
              `Message: ${payload.message || ''}`,
              payload.stack ? `Stack:\n${payload.stack}` : '',
              payload.componentStack ? `ComponentStack:\n${payload.componentStack}` : '',
              '',
            ]
              .filter(Boolean)
              .join('\n') + '\n';
            fs.appendFileSync(path.join(logDir, 'frontend_errors.log'), entry, 'utf-8');
            const gwLine = `${ts.replace('T', ' ').slice(0, 19)} | ERROR   | FRONTEND_ERROR | type=${payload.type || 'ERROR'} | message=${payload.message || ''}\n`;
            fs.appendFileSync(path.join(logDir, 'gateway.log'), gwLine, 'utf-8');
          } catch {}
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ status: 'logged' }));
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), optionalPeerStubPlugin()],
  resolve: {
    alias: [
      {
        find: /^@akalin\/ui$/,
        replacement: path.resolve(__dirname, 'vendor/akalin-ui/src/index.ts'),
      },
      {
        find: /^@akalin\/module[-_]core$/,
        replacement: path.resolve(__dirname, 'vendor/akalin-module-core/src/index.ts'),
      },
      {
        find: /^@akalin\/email[-_]module$/,
        replacement: path.resolve(__dirname, 'node_modules/@akalin/email_module/src/index.ts'),
      },
      {
        find: /^@akalin\/global[-_]search[-_]module$/,
        replacement: path.resolve(__dirname, 'node_modules/@akalin/global_search_module/src/index.ts'),
      },
    ],
    dedupe: [
      'react',
      'react-dom',
      'react-router-dom',
      'react-i18next',
      'i18next',
      'react-hot-toast',
      'lucide-react',
      'axios',
    ],
  },
  optimizeDeps: {
    force: true,
    exclude: [
      '@akalin/ui',
      '@akalin/module_core',
      '@akalin/module-core',
      '@akalin/email_module',
      '@akalin/email-module',
      '@akalin/global_search_module',
      '@akalin/global-search-module',
    ],
    extensions: ['.tsx', '.jsx'],
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      'react-router-dom',
      'react-i18next',
      'i18next',
      'react-hot-toast',
      'lucide-react',
      'axios',
    ],
  },
  server: {
    port: 5173,
    watch: {
      ignored: ['!**/node_modules/@akalin/ui/**'],
    },
    proxy: {
      '/v1': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            proxyReq.setHeader('Accept-Encoding', 'identity');
            if (req.method === 'POST' && req.url?.includes('/chat/completions')) {
              const reqAny = req as unknown as Record<string, unknown>;
              reqAny.__startTime = Date.now();
              let rawReqBody = '';
              req.on('data', (chunk) => {
                rawReqBody += chunk.toString();
              });
              req.on('end', () => {
                try {
                  reqAny.__parsedBody = JSON.parse(rawReqBody || '{}');
                } catch {
                  reqAny.__parsedBody = {};
                }
              });
            }
          });
          proxy.on('proxyRes', (proxyRes, req) => {
            if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
              proxyRes.headers['cache-control'] = 'no-cache, no-transform';
              proxyRes.headers['x-accel-buffering'] = 'no';
              proxyRes.headers['connection'] = 'keep-alive';
            }
            if (
              req.method === 'POST' &&
              req.url?.includes('/chat/completions') &&
              proxyRes.statusCode === 200
            ) {
              const reqAny = req as unknown as Record<string, unknown>;
              let rawResBody = '';
              proxyRes.on('data', (chunk) => {
                rawResBody += chunk.toString();
              });
              proxyRes.on('end', () => {
                try {
                  const parsedReq = (reqAny.__parsedBody || {}) as Record<string, unknown>;
                  if (parsedReq.source === 'studio') {
                    // Studio turns are persisted by ChatStudioView via /admin/conversations/record-turn
                    return;
                  }
                  const authHeader = (req.headers['authorization'] as string) || '';
                  const xUserId = (req.headers['x-user-id'] as string) || '';
                  let assistantText = '';
                  if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
                    const lines = rawResBody.split('\n');
                    for (const line of lines) {
                      const trimmed = line.trim();
                      if (trimmed.startsWith('data: ') && trimmed !== 'data: [DONE]') {
                        try {
                          const chunkJson = JSON.parse(trimmed.slice(6));
                          const delta = chunkJson.choices?.[0]?.delta?.content;
                          if (delta) assistantText += delta;
                        } catch {}
                      }
                    }
                  } else {
                    const resJson = JSON.parse(rawResBody || '{}');
                    assistantText = resJson.choices?.[0]?.message?.content || '';
                  }
                  if (assistantText) {
                    const latencyMs = Date.now() - Number(reqAny.__startTime || Date.now());
                    runSqliteBridge({
                      action: 'record_turn',
                      authorization: authHeader,
                      x_user_id: xUserId,
                      payload: {
                        conversation_id: parsedReq.conversation_id || undefined,
                        model: parsedReq.model || 'gpt-4o',
                        provider: 'gateway',
                        source: 'api',
                        messages: Array.isArray(parsedReq.messages) ? parsedReq.messages : [],
                        assistant_content: assistantText,
                        latency_ms: latencyMs,
                        ttft_ms: Math.max(100, Math.round(latencyMs * 0.35)),
                        authorization: authHeader,
                        x_user_id: xUserId,
                      },
                    });
                  }
                } catch {}
              });
            }
          });
        },
      },
      '/chat/completions': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/api/v1': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/admin/state': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/admin/logs': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/admin/users': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/admin/api-keys': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/admin/settings': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/admin/proxies': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/admin/parse-file': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/docs': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/openapi.json': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
});
