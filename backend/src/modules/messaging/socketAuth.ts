import { Socket } from 'socket.io';
import { verifyAccessToken, TokenPayload } from '../auth/tokens';

// Socket.io equivalent of the requireAuth middleware. The client sends its
// access token in the handshake auth payload; we verify it once at connect
// time and attach the decoded user to the socket for the whole session.

export interface AuthedSocket extends Socket {
  user?: TokenPayload;
}

export function socketAuth(socket: AuthedSocket, next: (err?: Error) => void) {
  const token = socket.handshake.auth?.token;

  if (!token) {
    return next(new Error('Missing auth token'));
  }

  try {
    socket.user = verifyAccessToken(token);
    next();
  } catch (err) {
    next(new Error('Invalid or expired token'));
  }
}
