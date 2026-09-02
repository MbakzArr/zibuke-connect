import { Request, Response } from 'express';
import { loginUser, refreshAccessToken } from './auth.service';

export async function login(req: Request, res: Response) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    const result = await loginUser({ email, password });
    return res.status(200).json(result);
  } catch (err: any) {
    if (err.message === 'INVALID_CREDENTIALS') {
      // Deliberately vague, don't reveal whether the email exists
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Something went wrong while logging in' });
  }
}

export async function refresh(req: Request, res: Response) {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ error: 'refreshToken is required' });
    }
    const result = refreshAccessToken(refreshToken);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired refresh token' });
  }
}
