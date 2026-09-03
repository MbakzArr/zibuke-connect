import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { httpServerHandler } from 'cloudflare:node';
import authRoutes from './modules/auth/auth.routes';
import departmentsRoutes from './modules/departments/departments.routes';
import channelsRoutes from './modules/channels/channels.routes';
import directoryRoutes from './modules/directory/directory.routes';
import messagingRoutes from './modules/messaging/messaging.routes';
import notificationsRoutes from './modules/notifications/notifications.routes';
import announcementsRoutes from './modules/announcements/announcements.routes';
import webhooksRoutes from './modules/webhooks/webhooks.routes';
import reactionsRoutes from './modules/reactions/reactions.routes';
import eventsRoutes from './modules/events/events.routes';
import usersRoutes from './modules/users/users.routes';
import adminRoutes from './modules/admin/admin.routes';
import tasksRoutes from './modules/tasks/tasks.routes';
import { openApiSpec } from './docs/openapi';
import { requireAuth } from './middleware/requireAuth';
import { RealtimeRoom } from './durable/RealtimeRoom';

// The Durable Object class itself must be exported from the main module
// for the binding in wrangler.jsonc to find it.
export { RealtimeRoom };

// CLOUDFLARE WORKERS ENTRY POINT (cloudflare branch only - the Render/
// Node entry point on main/develop is a separate, unmodified file). No
// dotenv here: Workers has no local filesystem to read a .env file from
// at runtime, and it doesn't need one anyway - with nodejs_compat and a
// recent compatibility_date, process.env is already populated directly
// from this Worker's configured vars/secrets (see wrangler.jsonc and
// `wrangler secret put`), automatically, before any code here runs.

const app = express();

// Supports multiple frontends talking to the same backend at once - e.g.
// the Netlify practice deployment and a Cloudflare deployment both hitting
// this same Render backend simultaneously, which is exactly the situation
// during the Cloudflare migration: FRONTEND_ORIGIN can be a single URL or
// a comma-separated list ("https://a.com,https://b.com"), and every origin
// in that list is allowed - nothing currently pointed at this backend loses
// access when a new frontend is added, they just get appended to the list.
const allowedOrigins = (process.env.FRONTEND_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(helmet());
// Restrict CORS to the known frontend origin(s) rather than allowing any
// site. The cors package's function form lets us check against the list
// above instead of a single hardcoded string.
app.use(
  cors({
    origin(origin, callback) {
      // No Origin header at all (curl, server-to-server, same-origin) -
      // let it through; there's nothing to check against.
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`Origin ${origin} is not allowed`));
      }
    },
  })
);
// Cap request bodies so a single huge payload can't exhaust memory.
// Not express.json() - that pulls in body-parser -> raw-body -> iconv-lite,
// and iconv-lite's stream handling (there to support non-UTF-8 charsets,
// which this API never needs - it's always UTF-8 JSON) doesn't work
// correctly under Workers' node:stream polyfill. wrangler's --dry-run
// bundle check doesn't catch this - the real `wrangler deploy` upload
// step briefly executes the bundle to validate it, and that's what
// surfaced "require_streams(...) is not a function" from deep inside
// iconv-lite. This is a small, dependency-free replacement using nothing
// but the same raw Node request-stream events httpServerHandler already
// bridges correctly, so there's no third-party parsing chain to break.
const JSON_BODY_LIMIT_BYTES = 100 * 1024; // 100kb, same cap as before

app.use((req, res, next) => {
  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('application/json')) {
    req.body = {};
    return next();
  }

  let raw = '';
  let tooLarge = false;

  req.on('data', (chunk) => {
    if (tooLarge) return;
    raw += typeof chunk === 'string' ? chunk : chunk.toString();
    if (raw.length > JSON_BODY_LIMIT_BYTES) {
      tooLarge = true;
      res.status(413).json({ error: 'Request body too large' });
      req.destroy();
    }
  });

  req.on('end', () => {
    if (tooLarge) return; // response already sent above
    if (!raw) {
      req.body = {};
      return next();
    }
    try {
      req.body = JSON.parse(raw);
      next();
    } catch {
      res.status(400).json({ error: 'Invalid JSON in request body' });
    }
  });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// The interactive Swagger UI page (swagger-ui-express) is gone on this
// branch - it serves its bundled HTML/CSS/JS off disk via __dirname,
// neither of which exists on Workers (no real filesystem, no CommonJS
// globals), and it crashed the whole worker on startup rather than just
// that one route. The raw JSON spec below needs neither - it's already
// an in-memory object - so it's kept as the one true source of the API
// shape; paste it into Postman, Swagger Editor, or any external Swagger
// UI instance for the same browsing experience.
app.get('/api/docs.json', (_req, res) => res.json(openApiSpec));

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/departments', departmentsRoutes);
app.use('/api/v1/channels', channelsRoutes);
app.use('/api/v1/directory', directoryRoutes);
app.use('/api/v1/messages', messagingRoutes);
app.use('/api/v1/notifications', notificationsRoutes);
app.use('/api/v1/announcements', announcementsRoutes);
app.use('/api/v1/webhooks', webhooksRoutes);
app.use('/api/v1/reactions', reactionsRoutes);
app.use('/api/v1/events', eventsRoutes);
app.use('/api/v1/users', usersRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/tasks', tasksRoutes);

app.get('/api/v1/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// STAGE 3 - real-time messaging. Socket.io doesn't run on Workers (its
// internals depend on a persistent Node process to hold state in), so
// the Cloudflare-native replacement is a Durable Object using native
// WebSockets (see src/durable/RealtimeRoom.ts for the full design). The
// REST API doesn't need to change for this - every place it pushes a
// live update (emitToChannel/broadcastToOrg/emitToUser in realtime.ts)
// already goes through those same three functions; only realtime.ts's
// own internals differ from the Render/Node version (that one talks to
// socket.io's `io`, this one POSTs to the Durable Object instead).

const PORT = process.env.PORT || 4000;
app.listen(PORT);

const expressHandler = httpServerHandler({ port: Number(PORT) });

interface Env {
  REALTIME_ROOM: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // A WebSocket upgrade can't be handled by Express at all - Node's
    // http.Server upgrade mechanism and the Workers WebSocketPair/101-
    // response primitive are different things, and the httpServerHandler
    // bridge only translates plain request/response traffic. So this one
    // route is intercepted here, before Express ever sees it, and handed
    // straight to the (single, global - see RealtimeRoom.ts) Durable
    // Object instance, which does its own auth and connection handling.
    if (url.pathname === '/ws') {
      const id = env.REALTIME_ROOM.idFromName('global');
      const stub = env.REALTIME_ROOM.get(id);
      return stub.fetch(request);
    }

    // Everything else: the same Express app as always. Cast to any here -
    // httpServerHandler()'s return type and the ambient Request/Env types
    // from @cloudflare/workers-types don't perfectly line up (a type-only
    // mismatch between two different typings of the same runtime request
    // object), this is just bridging that gap, not a real risk.
    return (expressHandler as any).fetch(request, env, ctx);
  },
};
