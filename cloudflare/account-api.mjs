import { accountFromToken, cookie, sessionCookies, supabase } from './supabase.mjs';

const grades = ['JSS 1', 'JSS 2', 'JSS 3', 'SS 1', 'SS 2', 'SS 3', 'Graduate', 'Other'];
const exams = ['JAMB', 'WAEC', 'NECO', 'School exams', 'General learning'];

function json(body, status = 200, headers) {
  const response = Response.json(body, { status });
  for (const [name, value] of Object.entries(headers || {})) {
    if (Array.isArray(value)) value.forEach(item => response.headers.append(name, item));
    else response.headers.set(name, value);
  }
  return response;
}

function profileFields(data) {
  const name = String(data?.name || '').trim().slice(0, 30);
  return name && grades.includes(data?.grade) && exams.includes(data?.exam)
    ? { name, grade: data.grade, exam: data.exam }
    : null;
}

function errorResponse(error) {
  if (error?.status === 401 && error?.detail?.includes('Invalid login credentials')) {
    return json({ error: 'That email and password do not match an account. Choose Create account if this is your first visit.' }, 401);
  }
  if (error?.status === 401 && error?.detail?.includes('Email not confirmed')) {
    return json({ error: 'Confirm your email, then sign in again.' }, 401);
  }
  if (error?.status === 429) {
    return json({ error: 'Email verification is temporarily rate-limited by Supabase. Please wait up to one hour before trying again.' }, 429);
  }
  if (error?.status && error.status < 500 && error?.detail?.includes('Auth')) {
    return json({ error: 'Supabase could not complete this sign-in request. Check your details and email confirmation.' }, error.status);
  }
  return json({ error: error?.status === 401 ? 'Sign in to enter the classroom.' : 'The classroom service is temporarily unavailable.' }, error?.status || 503);
}

async function body(request) {
  try { return await request.json(); } catch { return null; }
}

export async function accountFromCookies(request, env) {
  let token = cookie(request, 'classroom_access');
  let session = null;
  if (!token) {
    const refresh = cookie(request, 'classroom_refresh');
    if (!refresh) return null;
    session = await supabase(env, '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST', body: JSON.stringify({ refresh_token: refresh })
    });
    token = session.access_token;
  }
  return { account: await accountFromToken(token, env), session };
}

async function readProfile(account, env) {
  const [profile] = await supabase(env,
    `/rest/v1/classroom_profiles?select=name,grade,exam&user_id=eq.${account.user.id}`,
    { token: account.token });
  return profile || null;
}

export async function accountApi(request, env, pathname) {
  try {
    if (pathname === '/api/account' && request.method === 'GET') {
      const current = await accountFromCookies(request, env);
      if (!current) return json({ error: 'Sign in to enter the classroom.' }, 401);
      let profile = await readProfile(current.account, env);
      const initial = profileFields(current.account.user.user_metadata);
      if (!profile && initial) {
        await supabase(env, '/rest/v1/classroom_profiles', {
          method: 'POST', token: current.account.token, body: JSON.stringify({ user_id: current.account.user.id, ...initial }),
          headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }
        });
        profile = await readProfile(current.account, env);
      }
      return json({ profile, teacher: current.account.teacher, owner: current.account.owner }, 200,
        current.session ? { 'Set-Cookie': sessionCookies(request, current.session) } : undefined);
    }

    if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
    if (pathname === '/api/account/signout') {
      const token = cookie(request, 'classroom_access');
      if (token) await supabase(env, '/auth/v1/logout?scope=local', { method: 'POST', token }).catch(() => null);
      return json({ ok: true }, 200, { 'Set-Cookie': sessionCookies(request, null) });
    }

    const data = await body(request);
    if (!data) return json({ error: 'Invalid request.' }, 400);
    if (pathname === '/api/account/resend-confirmation') {
      const email = String(data.email || '').trim();
      if (!email || email.length > 254) return json({ error: 'Enter a valid email address.' }, 400);
      await supabase(env, '/auth/v1/resend', { method: 'POST', body: JSON.stringify({ email, type: 'signup' }) });
      return json({ ok: true });
    }
    if (pathname === '/api/account/signup' || pathname === '/api/account/signin') {
      const signup = pathname.endsWith('/signup');
      const profile = signup ? profileFields(data) : null;
      const email = String(data.email || '').trim();
      const password = String(data.password || '');
      if (!email || email.length > 254 || !password || password.length > 1024 || (signup && (password.length < 8 || !profile))) {
        return json({ error: 'Check your email, password, and required fields.' }, 400);
      }
      const session = await supabase(env, signup ? '/auth/v1/signup' : '/auth/v1/token?grant_type=password', {
        method: 'POST', body: JSON.stringify({ email, password, ...(profile ? { data: profile } : {}) })
      });
      if (!session.access_token) return json({ confirmationRequired: true });
      return json({ ok: true }, 200, { 'Set-Cookie': sessionCookies(request, session) });
    }
    if (pathname === '/api/account/profile') {
      const current = await accountFromCookies(request, env);
      if (!current) return json({ error: 'Sign in to enter the classroom.' }, 401);
      const profile = profileFields(data);
      if (!profile) return json({ error: 'Complete all learning preferences.' }, 400);
      await supabase(env, '/rest/v1/classroom_profiles', {
        method: 'POST', token: current.account.token, body: JSON.stringify({ user_id: current.account.user.id, ...profile }),
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }
      });
      return json({ profile }, 200, current.session ? { 'Set-Cookie': sessionCookies(request, current.session) } : undefined);
    }
    return json({ error: 'Not found.' }, 404);
  } catch (error) {
    return errorResponse(error);
  }
}
