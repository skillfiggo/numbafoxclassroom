import { ClassroomRoom } from './classroom-room.mjs';
import { authenticatedUser } from './supabase.mjs';
import { accountApi, accountFromCookies } from './account-api.mjs';
import { createTeachingStep } from './teacher-ai.mjs';

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
    if (request.method === 'GET' && url.pathname === '/api/classes') {
      const room = await publicRoom.fetch(new Request(new URL('/state', request.url))).then(response => response.json());
      const lesson = room.lesson || {};
      return Response.json(room.status === 'live' && lesson.topic ? [{
        id: lesson.id, title: lesson.topic, description: lesson.introduction || '', grade: lesson.grade || 'All levels', exam: lesson.exam || 'All goals'
      }] : []);
    }
    if (request.method === 'POST' && url.pathname === '/api/class/join') {
      const current = await accountFromCookies(request, env).catch(() => null);
      if (!current) return Response.json({ error: 'Sign in to join a class.' }, { status: 401 });
      const room = await publicRoom.fetch(new Request(new URL('/state', request.url))).then(response => response.json());
      if (room.status !== 'live') return Response.json({ error: 'This class is no longer live.' }, { status: 409 });
      return publicRoom.fetch(new Request(new URL('/state', request.url), {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Classroom-User': current.account.user.id, 'X-Classroom-Teacher': String(current.account.teacher) },
        body: JSON.stringify({ type: 'join' })
      }));
    }
    if (request.method === 'GET' && url.pathname === '/api/class/access') {
      const current = await accountFromCookies(request, env).catch(() => null);
      if (!current) return Response.json({ error: 'Sign in to enter the classroom.' }, { status: 401 });
      return publicRoom.fetch(new Request(new URL('/membership', request.url), {
        headers: { 'X-Classroom-User': current.account.user.id, 'X-Classroom-Teacher': String(current.account.teacher) }
      }));
    }
    if (request.method === 'POST' && url.pathname === '/api/lesson') {
      const current = await accountFromCookies(request, env).catch(() => null);
      if (!current) return Response.json({ error: 'Sign in to create a class.' }, { status: 401 });
      if (!current.account.teacher) return Response.json({ error: 'Only teachers can create classes.' }, { status: 403 });
      const lesson = await request.json().catch(() => null);
      if (!lesson?.topic || String(lesson.topic).trim().length > 200) {
        return Response.json({ error: 'Enter a class topic.' }, { status: 400 });
      }
      return publicRoom.fetch(new Request(new URL('/state', request.url), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Classroom-User': current.account.user.id,
          'X-Classroom-Teacher': 'true'
        },
        body: JSON.stringify({ type: 'lesson', lesson: {
          id: crypto.randomUUID(), topic: String(lesson.topic).trim(),
          introduction: String(lesson.introduction || '').trim().slice(0, 1200),
          question: String(lesson.question || '').trim().slice(0, 800),
          teacherGuidance: String(lesson.teacherGuidance || '').trim().slice(0, 1200),
          grade: String(lesson.grade || 'All levels').slice(0, 30),
          exam: String(lesson.exam || 'All goals').slice(0, 30),
          speaker: 'ai', step: 0, paused: false
        } })
      }));
    }
    if (request.method === 'POST' && url.pathname === '/api/ai') {
      const current = await accountFromCookies(request, env).catch(() => null);
      if (!current) return Response.json({ error: 'Sign in to guide the AI.' }, { status: 401 });
      if (!current.account.teacher) return Response.json({ error: 'Only teachers can guide the AI.' }, { status: 403 });
      const body = await request.json().catch(() => ({}));
      const room = await publicRoom.fetch(new Request(new URL('/state', request.url))).then(response => response.json());
      const result = await createTeachingStep(env, room, String(body.instruction || '').trim().slice(0, 800));
      if (result.error) return Response.json({ error: result.error }, { status: result.status });
      return publicRoom.fetch(new Request(new URL('/state', request.url), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Classroom-User': current.account.user.id, 'X-Classroom-Teacher': 'true' },
        body: JSON.stringify({ type: 'ai', update: result.update })
      }));
    }
    if (request.method === 'POST' && (url.pathname === '/api/class/clear' || url.pathname === '/api/class/end')) {
      const current = await accountFromCookies(request, env).catch(() => null);
      if (!current) return Response.json({ error: 'Sign in to manage this class.' }, { status: 401 });
      if (!current.account.teacher) return Response.json({ error: 'Only teachers can manage this class.' }, { status: 403 });
      const type = url.pathname.endsWith('/clear') ? 'clear' : 'end';
      return publicRoom.fetch(new Request(new URL('/state', request.url), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Classroom-User': current.account.user.id, 'X-Classroom-Teacher': 'true' },
        body: JSON.stringify({ type })
      }));
    }
    if (request.method === 'POST' && url.pathname === '/api/presence') {
      return publicRoom.fetch(new Request(new URL('/presence', request.url), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: request.body
      }));
    }
    if (request.method === 'POST' && url.pathname === '/api/leave') {
      const current = await accountFromCookies(request, env).catch(() => null);
      return publicRoom.fetch(new Request(new URL('/leave', request.url), {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(current ? { 'X-Classroom-User': current.account.user.id } : {}) }, body: request.body
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
