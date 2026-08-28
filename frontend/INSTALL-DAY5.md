# Day 5, part 1: Frontend foundation (login + app shell)

A fresh Vite + React + TypeScript PWA, built to talk to YOUR API. This first
part is the plumbing everything else hangs off: the API client (with
automatic token refresh), auth context, socket connection, the login screen,
and the workspace shell. It proves the full login -> authenticated ->
real-time-connected chain before we build features on top.

## Install (full paths)

1. New branch off develop:
   cd /home/arrhenius/Projects/zibuke-connect
   git checkout develop
   git checkout -b feature/frontend

2. The frontend goes in a NEW folder next to backend. Move the extracted
   project into the repo as "frontend":
   mv /home/arrhenius/Downloads/zibuke-frontend /home/arrhenius/Projects/zibuke-connect/frontend

3. Install dependencies:
   cd /home/arrhenius/Projects/zibuke-connect/frontend
   npm install

4. Set the API URL:
   cp .env.example .env
   (default is http://localhost:4000, which matches your backend)

5. Make sure the BACKEND is running in another terminal:
   cd /home/arrhenius/Projects/zibuke-connect/backend
   npm run dev

6. Start the frontend dev server:
   cd /home/arrhenius/Projects/zibuke-connect/frontend
   npm run dev
   Vite prints a URL, usually http://localhost:5173

## Test

Open http://localhost:5173 in your browser.

1. You should see the Zibuke Connect login screen.
2. Sign in with your existing test user:
     email:    arehone@zibuke.co.za
     password: testpassword123
3. On success the screen swaps to the workspace shell, showing your role
   and a "Connected" status once the socket opens. That green "Connected"
   means the WebSocket authenticated with your token and the live layer is
   working, same connection your messaging uses.
4. Refresh the page. You should STAY logged in (the token is stored and
   restored), not get bounced back to login.
5. Click "Sign out". You go back to login and the socket disconnects.

## What to notice for review
- ONE api client (src/api/client.ts) handles every request, attaches the
  token, and transparently refreshes an expired access token then retries.
  This is why the frontend won't hit the "token expired" wall you saw when
  testing with curl.
- Auth state lives in one context (AuthContext); the socket connection in
  another (SocketContext) that opens only when logged in and tears down on
  logout. Clean separation.
- The whole production build is ~74KB gzipped. That's the "data-bundle
  friendly / low-end device" requirement met with a real number.
- Design is deliberately calm: indigo anchor, lots of whitespace, one accent.
  An internal tool should get out of the way, and light visuals also keep it
  fast on an Android 7 phone.

## Structure
```
frontend/src/
  api/client.ts            - single fetch wrapper, token refresh
  context/AuthContext.tsx  - who am I, login/logout
  context/SocketContext.tsx - the one live connection
  pages/Login.tsx          - the unauthenticated screen
  pages/Workspace.tsx      - authenticated shell (placeholder body for now)
  styles/tokens.css        - design tokens (colors, type, spacing)
```

Commit when it works:
  cd /home/arrhenius/Projects/zibuke-connect
  git add .
  git commit -m "Day 5: frontend foundation - login, auth, socket, app shell"

Next: the Company Hub landing screen and the channel list + live messaging UI.
