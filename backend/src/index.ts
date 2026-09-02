import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
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
import { attachSocketServer } from './modules/messaging/socketGateway';
import swaggerUi from 'swagger-ui-express';
import { openApiSpec } from './docs/openapi';
import { requireAuth } from './middleware/requireAuth';

dotenv.config();

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
app.use(express.json({ limit: '100kb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Interactive API documentation. Browsable at /api/docs; the raw OpenAPI
// spec is at /api/docs.json for tooling/codegen.
app.get('/api/docs.json', (_req, res) => res.json(openApiSpec));
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));

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

// Express and Socket.io share one HTTP server, so both run on the same port.
const httpServer = http.createServer(app);
attachSocketServer(httpServer, allowedOrigins);

const PORT = process.env.PORT || 4000;

httpServer.listen(PORT, () => {
  console.log(`Zibuke Collab API + WebSocket listening on port ${PORT}`);
});
