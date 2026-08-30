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
import { attachSocketServer } from './modules/messaging/socketGateway';
import swaggerUi from 'swagger-ui-express';
import { openApiSpec } from './docs/openapi';
import { requireAuth } from './middleware/requireAuth';

dotenv.config();

const app = express();

app.use(helmet());
// Restrict CORS to the frontend origin rather than allowing any site. The
// origin is configurable so the deployed frontend URL can be set in prod.
app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
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

app.get('/api/v1/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// Express and Socket.io share one HTTP server, so both run on the same port.
const httpServer = http.createServer(app);
attachSocketServer(httpServer);

const PORT = process.env.PORT || 4000;

httpServer.listen(PORT, () => {
  console.log(`Zibuke Collab API + WebSocket listening on port ${PORT}`);
});
