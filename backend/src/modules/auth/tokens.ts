import jwt from 'jsonwebtoken';

export interface TokenPayload {
  userId: string;
  organizationId: string;
  role: string;
}

export function signAccessToken(payload: TokenPayload): string {
  const options: jwt.SignOptions = {
    expiresIn: (process.env.JWT_ACCESS_EXPIRES || '15m') as jwt.SignOptions['expiresIn'],
  };
  return jwt.sign(payload, process.env.JWT_ACCESS_SECRET as string, options);
}

export function signRefreshToken(payload: TokenPayload): string {
  const options: jwt.SignOptions = {
    expiresIn: (process.env.JWT_REFRESH_EXPIRES || '7d') as jwt.SignOptions['expiresIn'],
  };
  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET as string, options);
}

export function verifyAccessToken(token: string): TokenPayload {
  return jwt.verify(token, process.env.JWT_ACCESS_SECRET as string) as TokenPayload;
}

export function verifyRefreshToken(token: string): TokenPayload {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET as string) as TokenPayload;
}
