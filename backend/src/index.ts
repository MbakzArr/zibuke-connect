import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import authRoutes from './modules/auth/auth.routes';
import departmentsRoutes from './modules/departments/departments.routes';
import channelsRoutes from './modules/channels/channels.routes';
import { requireAuth } from './middleware/requireAuth';

dotenv.config();

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/departments', departmentsRoutes);
app.use('/api/v1/channels', channelsRoutes);

// Quick proof the middleware works, this can be deleted once real
// protected routes (channels, messaging) exist.
app.get('/api/v1/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`Zibuke Collab API listening on port ${PORT}`);
});
