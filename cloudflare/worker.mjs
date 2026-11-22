import { ClassroomRoom } from './classroom-room.mjs';
import { authenticatedUser } from './supabase.mjs';

export { ClassroomRoom };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
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
    return env.ASSETS.fetch(request);
  }
};
