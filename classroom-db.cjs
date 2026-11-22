const url = process.env.SUPABASE_URL?.replace(/\/+$/, '');
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const configured = Boolean(url && publishableKey && secretKey);
const teacherIds = new Set((process.env.CLASSROOM_TEACHER_IDS || '').split(',').map(id => id.trim()));

function failure(status, message) {
  return Object.assign(new Error(message), { status, publicMessage: message });
}

async function request(path, { token, privileged = false, method = 'GET', data, prefer } = {}) {
  if (!configured) throw failure(503, 'The classroom database is not configured.');
  let response;
  try {
    response = await fetch(url + path, {
      method,
      headers: {
        apikey: privileged ? secretKey : publishableKey,
        ...((token || (privileged && secretKey.startsWith('eyJ')))
          ? { Authorization: 'Bearer ' + (token || secretKey) } : {}),
        ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(prefer ? { Prefer: prefer } : {})
      },
      body: data === undefined ? undefined : JSON.stringify(data),
      signal: AbortSignal.timeout(8000)
    });
  } catch {
    throw failure(502, 'The classroom database is unavailable.');
  }
  if (!response.ok) {
    if (path.startsWith('/auth/') && response.status < 500) {
      const detail = await response.text().catch(() => '');
      if (detail.includes('Invalid login credentials')) {
        throw failure(401, 'That email and password do not match an account. Choose Create account if this is your first visit.');
      }
      if (detail.includes('Email not confirmed')) {
        throw failure(401, 'Confirm your email, then sign in again.');
      }
      throw failure(response.status === 429 ? 429 : 401, response.status === 429
        ? 'Email verification is temporarily rate-limited by Supabase. Please wait up to one hour before trying again.'
        : 'Supabase could not complete this sign-in request. Check your details and email confirmation.');
    }
    throw failure(502, 'The classroom database could not complete the request.');
  }
  const payload = await response.text();
  return payload ? JSON.parse(payload) : null;
}

function saveRow(table, data, options = {}) {
  return request('/rest/v1/' + table, {
    ...options, method: 'POST', data, prefer: 'resolution=merge-duplicates,return=minimal'
  });
}

function cookie(req, name) {
  return (req.headers.cookie || '').split(';').map(part => part.trim())
    .find(part => part.startsWith(name + '='))?.slice(name.length + 1);
}

function setSession(res, session) {
  const secure = url && process.env.CLASSROOM_SECURE_COOKIES === '1' ? '; Secure' : '';
  const value = (name, token, age) => name + '=' + (token || '') +
    '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + (token ? age : 0) + secure;
  res.setHeader('Set-Cookie', [
    value('classroom_access', session?.access_token, session?.expires_in || 3600),
    value('classroom_refresh', session?.refresh_token, 30 * 86400)
  ]);
}

async function authenticate(req, res, allowRefresh = false) {
  let token = cookie(req, 'classroom_access');
  if (!token && allowRefresh) {
    const refresh = cookie(req, 'classroom_refresh');
    if (refresh) {
      const session = await request('/auth/v1/token?grant_type=refresh_token', {
        method: 'POST', data: { refresh_token: refresh }
      });
      setSession(res, session);
      token = session.access_token;
    }
  }
  if (!token) throw failure(401, 'Sign in to enter the classroom.');
  const user = await request('/auth/v1/user', { token });
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  return { token, user, expiresAt: claims.exp * 1000, teacher: teacherIds.has(user.id) };
}

function profileFields(data) {
  const grades = ['JSS 1', 'JSS 2', 'JSS 3', 'SS 1', 'SS 2', 'SS 3', 'Graduate', 'Other'];
  const exams = ['JAMB', 'WAEC', 'NECO', 'School exams', 'General learning'];
  const name = String(data?.name || '').trim().slice(0, 30);
  if (!name || !grades.includes(data?.grade) || !exams.includes(data?.exam)) return null;
  return { name, grade: data.grade, exam: data.exam };
}

async function readProfile({ token, user }) {
  const [profile] = await request('/rest/v1/classroom_profiles?select=name,grade,exam&user_id=eq.' + user.id, { token });
  return profile || null;
}

async function route(req, res, path, body) {
  if (path === '/api/account' && req.method === 'GET') {
    const account = await authenticate(req, res, true);
    let profile = await readProfile(account);
    const initial = profileFields(account.user.user_metadata);
    if (!profile && initial) {
      await request('/rest/v1/classroom_profiles', {
        method: 'POST', token: account.token, data: { user_id: account.user.id, ...initial },
        prefer: 'resolution=ignore-duplicates,return=minimal'
      });
      profile = await readProfile(account);
    }
    return { profile, teacher: account.teacher };
  }
  if (req.method !== 'POST') throw failure(405, 'Method not allowed.');
  if (path === '/api/account/signout') {
    const token = cookie(req, 'classroom_access');
    setSession(res, null);
    if (token) {
      await request('/auth/v1/logout?scope=local', { method: 'POST', token })
        .catch(error => { if (error.status !== 401) throw error; });
    }
    return { ok: true };
  }
  const data = await body(req);
  if (path === '/api/account/resend-confirmation') {
    const email = String(data?.email || '').trim();
    if (!email || email.length > 254) throw failure(400, 'Enter a valid email address.');
    await request('/auth/v1/resend', { method: 'POST', data: { email, type: 'signup' } });
    return { ok: true };
  }
  if (path === '/api/account/signup' || path === '/api/account/signin') {
    const signup = path.endsWith('/signup');
    const profile = signup ? profileFields(data) : null;
    const email = String(data?.email || '').trim();
    const password = String(data?.password || '');
    if (!email || email.length > 254 || !password || password.length > 1024 || (signup && (password.length < 8 || !profile))) {
      throw failure(400, 'Check your email, password, and required fields.');
    }
    const session = await request(signup ? '/auth/v1/signup' : '/auth/v1/token?grant_type=password', {
      method: 'POST', data: { email, password, ...(profile ? { data: profile } : {}) }
    });
    if (!session.access_token) return { confirmationRequired: true };
    setSession(res, session);
    return { ok: true };
  }
  if (path === '/api/account/profile') {
    const account = await authenticate(req, res, true);
    const profile = profileFields(data);
    if (!profile) throw failure(400, 'Complete all learning preferences.');
    await saveRow('classroom_profiles', { user_id: account.user.id, ...profile }, { token: account.token });
    return { profile };
  }
  throw failure(404, 'Not found.');
}

async function loadRoom() {
  const [room] = await request('/rest/v1/classroom_room?id=eq.1&select=snapshot', { privileged: true });
  return room?.snapshot;
}

function saveRoom(snapshot) {
  return saveRow('classroom_room', { id: 1, snapshot }, { privileged: true });
}

function history({ token, user }) {
  return request('/rest/v1/classroom_visits?select=topic,at:visited_at,rows,working&order=visited_at.desc&limit=40&user_id=eq.' + user.id, { token });
}

function saveVisit(userId, { lesson, board, working }) {
  const rows = board.rows.map(row => ({ text: row.text ?? row.cells?.map(cell => cell.text).join(' ') ?? '' }));
  return saveRow('classroom_visits', {
    user_id: userId, lesson_id: lesson.id, topic: lesson.topic, rows, working
  }, { privileged: true });
}

module.exports = { configured, authenticate, readProfile, failure, route, loadRoom, saveRoom, history, saveVisit };
