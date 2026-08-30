// OpenAPI 3 spec for the Zibuke Connect API. Served interactively at
// /api/docs via swagger-ui. This is the browsable proof that the platform
// exposes a documented API for integrations. Kept in one file so it's easy
// to read and keep in step with the routes.

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Zibuke Connect API',
    version: '1.0.0',
    description:
      'Internal collaboration platform API. Employee messaging, channels, ' +
      'direct messages, directory, announcements, notifications and inbound ' +
      'webhooks for external system integration.',
  },
  servers: [{ url: 'http://localhost:4000', description: 'Local development' }],
  tags: [
    { name: 'Auth', description: 'Registration, login and token refresh' },
    { name: 'Directory', description: 'Employee search and profiles' },
    { name: 'Departments', description: 'Organizational departments' },
    { name: 'Channels', description: 'Channels and direct messages' },
    { name: 'Messages', description: 'Message history and edits' },
    { name: 'Announcements', description: 'Company and department announcements' },
    { name: 'Notifications', description: 'User notifications' },
    { name: 'Webhooks', description: 'Inbound integration endpoints' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      webhookToken: {
        type: 'http',
        scheme: 'bearer',
        description: 'A per-webhook token (whk_...) rather than a user JWT.',
      },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    '/api/v1/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Register a new user',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['organizationId', 'email', 'password', 'fullName'],
                properties: {
                  organizationId: { type: 'string', format: 'uuid' },
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string', minLength: 8 },
                  fullName: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'User created' }, '409': { description: 'Email already registered' } },
      },
    },
    '/api/v1/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Log in and receive access + refresh tokens',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Tokens issued' }, '401': { description: 'Invalid credentials' } },
      },
    },
    '/api/v1/auth/refresh': {
      post: {
        tags: ['Auth'],
        summary: 'Exchange a refresh token for a new access token',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['refreshToken'], properties: { refreshToken: { type: 'string' } } },
            },
          },
        },
        responses: { '200': { description: 'New access token' }, '401': { description: 'Invalid refresh token' } },
      },
    },
    '/api/v1/directory': {
      get: {
        tags: ['Directory'],
        summary: 'List employees (paginated)',
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 25, maximum: 100 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
          { name: 'departmentId', in: 'query', schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'A page of employees' } },
      },
    },
    '/api/v1/directory/search': {
      get: {
        tags: ['Directory'],
        summary: 'Search employees by name, title or department',
        parameters: [{ name: 'q', in: 'query', required: true, schema: { type: 'string', minLength: 2 } }],
        responses: { '200': { description: 'Matching employees' } },
      },
    },
    '/api/v1/directory/birthdays': {
      get: { tags: ['Directory'], summary: "Employees whose birthday is today", responses: { '200': { description: 'List' } } },
    },
    '/api/v1/departments': {
      get: { tags: ['Departments'], summary: 'List departments', responses: { '200': { description: 'Departments' } } },
      post: {
        tags: ['Departments'],
        summary: 'Create a department (admin only)',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, headUserId: { type: 'string', format: 'uuid' } } } } },
        },
        responses: { '201': { description: 'Created' }, '403': { description: 'Not permitted' } },
      },
    },
    '/api/v1/channels': {
      get: { tags: ['Channels'], summary: 'List channels you can see', responses: { '200': { description: 'Channels' } } },
      post: {
        tags: ['Channels'],
        summary: 'Create a channel',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, isPrivate: { type: 'boolean' }, departmentId: { type: 'string', format: 'uuid' } } } } },
        },
        responses: { '201': { description: 'Created' } },
      },
    },
    '/api/v1/channels/dm': {
      get: { tags: ['Channels'], summary: 'List your direct messages', responses: { '200': { description: 'DMs' } } },
    },
    '/api/v1/channels/dm/{userId}': {
      post: {
        tags: ['Channels'],
        summary: 'Open (or reuse) a direct message with a user',
        parameters: [{ name: 'userId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'The DM channel' } },
      },
    },
    '/api/v1/channels/{id}/join': {
      post: {
        tags: ['Channels'],
        summary: 'Join a public channel',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'Joined' }, '403': { description: 'Invite-only' } },
      },
    },
    '/api/v1/messages/channel/{channelId}': {
      get: {
        tags: ['Messages'],
        summary: 'Message history for a channel (keyset paginated)',
        parameters: [
          { name: 'channelId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 30, maximum: 100 } },
          { name: 'before', in: 'query', schema: { type: 'string', format: 'date-time' }, description: 'created_at of the oldest message you have' },
        ],
        responses: { '200': { description: 'Messages, newest first' }, '403': { description: 'Not a member' } },
      },
    },
    '/api/v1/messages/{id}': {
      patch: {
        tags: ['Messages'],
        summary: 'Edit your own message',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['content'], properties: { content: { type: 'string' } } } } } },
        responses: { '200': { description: 'Updated' }, '403': { description: 'Not the author' } },
      },
      delete: {
        tags: ['Messages'],
        summary: 'Delete your own message (soft delete)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'Deleted' }, '403': { description: 'Not the author' } },
      },
    },
    '/api/v1/announcements': {
      get: { tags: ['Announcements'], summary: 'List announcements', responses: { '200': { description: 'Announcements' } } },
      post: {
        tags: ['Announcements'],
        summary: 'Post an announcement (admin only)',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['title', 'content'], properties: { title: { type: 'string' }, content: { type: 'string' }, departmentId: { type: 'string', format: 'uuid' } } } } } },
        responses: { '201': { description: 'Posted' }, '403': { description: 'Not permitted' } },
      },
    },
    '/api/v1/notifications': {
      get: {
        tags: ['Notifications'],
        summary: 'List your notifications',
        parameters: [{ name: 'unread', in: 'query', schema: { type: 'boolean' } }],
        responses: { '200': { description: 'Notifications' } },
      },
    },
    '/api/v1/webhooks': {
      get: { tags: ['Webhooks'], summary: 'List webhooks (admin)', responses: { '200': { description: 'Webhooks' } } },
      post: {
        tags: ['Webhooks'],
        summary: 'Create a webhook for a channel (admin). Returns the token once.',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['channelId', 'label'], properties: { channelId: { type: 'string', format: 'uuid' }, label: { type: 'string' } } } } } },
        responses: { '201': { description: 'Created; token returned once' } },
      },
    },
    '/api/v1/webhooks/inbound': {
      post: {
        tags: ['Webhooks'],
        summary: 'Post a message into a channel from an external system',
        description: 'Authenticated by a webhook token (Authorization: Bearer whk_...), not a user JWT.',
        security: [{ webhookToken: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['text'], properties: { text: { type: 'string' } } } } } },
        responses: { '201': { description: 'Message posted' }, '401': { description: 'Invalid webhook token' } },
      },
    },
  },
};
