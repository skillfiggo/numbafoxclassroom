import { ClassroomRoom } from './classroom-room.mjs';
import { authenticatedUser } from './supabase.mjs';
import { accountApi } from './account-api.mjs';

export { ClassroomRoom };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const publicRoom = env.CLASSROOM_ROOM.getByName('public-classroom');
    if (url.pathname === '/api/account' || url.pathname.startsWith('/api/account/')) {
      return accountApi(request, env, url.pathname);
    }
    if (request.method === 'GET' && url.pathname === '/api/classroom-mode') {
      return Response.json({ localPreview: false });
    }
    if (request.method === 'GET' && url.pathname === '/events') {
      const headers = new Headers(request.headers);
      headers.set('X-Classroom-Client', url.searchParams.get('id') || crypto.randomUUID());
      return publicRoom.fetch(new Request(new URL('/events', request.url), { headers }));
    }
    if (request.method === 'GET' && url.pathname === '/api/state') {
      return publicRoom.fetch(new Request(new URL('/state', request.url)));
    }
    if (request.method === 'POST' && url.pathname === '/api/presence') {
      return publicRoom.fetch(new Request(new URL('/presence', request.url), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: request.body
      }));
    }
    if (request.method === 'POST' && (url.pathname === '/api/message' || url.pathname === '/api/question')) {
      const body = await request.json();
      const type = url.pathname.endsWith('/message') ? 'message' : 'question';
      const item = {
        id: crypto.randomUUID(),
        name: String(body.name || 'Guest').slice(0, 30),
        text: String(body.text || '').slice(0, 1000),
        at: Date.now(),
        votes: 0
      };
      if (!item.text.trim()) return Response.json({ error: 'Write a message first.' }, { status: 400 });
      return publicRoom.fetch(new Request(new URL('/state', request.url), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Classroom-User': `guest:${crypto.randomUUID()}` },
        body: JSON.stringify({ type, [type]: item })
      }));
    }
    if (url.pathname.startsWith('/room/')) {
      const [, , roomId, action = 'state'] = url.pathname.split('/');
      if (!roomId) return new Response('Room ID required', { status: 400 });
      const account = await authenticatedUser(request, env);
      if (!account) return Response.json({ error: 'Sign in to enter the classroom.' }, { status: 401 });
      // Durable Objects are private to this Worker. These identity headers are added
      // only after the Supabase access token is checked, never trusted from a client.
      const headers = new Headers(request.headers);
      headers.set('X-Classroom-User', account.user.id);
      headers.set('X-Classroom-Teacher', String(account.teacher));
      const roomRequest = new Request(new URL('/' + action, request.url), {
        method: request.method,
        headers,
        body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
        redirect: request.redirect
      });
      return env.CLASSROOM_ROOM.getByName(roomId).fetch(roomRequest);
    }
    if (url.pathname.startsWith('/api/')) {
      return Response.json({ error: 'This classroom endpoint is not available yet.' }, { status: 404 });
    }
    return env.ASSETS.fetch(request);
  }
};
