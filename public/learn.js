const $ = selector => document.querySelector(selector);
let profile = null;
let editing = false;
let classes = [];
let classesStatus = 'Loading classes…';
let accountRevision = 0;
let isTeacher = false;
let teacherClassDialog = null;
let teacherClassFormHome = null;

function create(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

async function request(path, data) {
  const response = await fetch('/api/' + path, data === undefined ? { cache: 'no-store' } : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error), { status: response.status });
  return result;
}

function setAuthTab(tab) {
  const signIn = tab === 'signin';
  $('#verification-pending').hidden = true;
  $('#signup-preview').hidden = signIn;
  $('#signin-preview').hidden = !signIn;
  for (const [id, selected] of [['#signup-tab', !signIn], ['#signin-tab', signIn]]) {
    $(id).classList.toggle('active', selected);
    $(id).setAttribute('aria-selected', String(selected));
  }
}

function openWelcome(tab, edit = false, canCancel = edit) {
  editing = edit;
  hideAccountChrome();
  $('#welcome').hidden = false;
  $('#student-app').hidden = true;
  $('#auth-tabs').hidden = edit;
  $('#cancel-edit').hidden = !canCancel;
  $('#verification-pending').hidden = true;
  $('#signin-message').textContent = '';
  $('#profile-submit').textContent = edit ? 'Save preferences' : 'Create account';
  for (const id of ['signup-email', 'signup-password']) {
    const input = $('#' + id);
    input.hidden = edit;
    input.required = !edit;
    if (edit) input.value = '';
    document.querySelector('label[for="' + id + '"]').hidden = edit;
  }
  $('#student-name').value = edit ? profile?.name || '' : '';
  $('#student-grade').value = edit ? profile?.grade || '' : '';
  $('#student-exam').value = edit ? profile?.exam || '' : '';
  setAuthTab(tab);
}

function openVerification(email) {
  hideAccountChrome();
  $('#welcome').hidden = false;
  $('#student-app').hidden = true;
  $('#auth-tabs').hidden = true;
  $('#signup-preview').hidden = true;
  $('#signin-preview').hidden = true;
  $('#cancel-edit').hidden = true;
  $('#signin-message').textContent = '';
  $('#verification-email').textContent = email;
  $('#verification-message').textContent = '';
  $('#verification-pending').hidden = false;
  $('#signin-email').value = email;
}

async function loadAccount() {
  const account = await request('account');
  profile = account.profile;
  isTeacher = Boolean(account.teacher);
  accountRevision++;
  if (profile) openApp('classes');
  else openWelcome('signup', true, false);
}

function handleForm(selector, action) {
  $(selector).onsubmit = async event => {
    event.preventDefault();
    const button = event.submitter || $(selector).querySelector('button[type="submit"]');
    if (button.disabled) return;
    button.disabled = true;
    $('#signin-message').textContent = '';
    try { await action(); }
    catch (error) { $('#signin-message').textContent = error.message; }
    finally { button.disabled = false; }
  };
}

$('#signup-tab').onclick = () => { $('#signin-message').textContent = ''; setAuthTab('signup'); };
$('#signin-tab').onclick = () => { $('#signin-message').textContent = ''; setAuthTab('signin'); };
handleForm('#profile-form', async () => {
  const details = {
    name: $('#student-name').value.trim(), grade: $('#student-grade').value, exam: $('#student-exam').value
  };
  if (editing) {
    ({ profile } = await request('account/profile', details));
    openApp('profile');
    return;
  }
  const result = await request('account/signup', {
    ...details, email: $('#signup-email').value, password: $('#signup-password').value
  });
  const email = $('#signup-email').value.trim();
  $('#signup-password').value = '';
  if (result.confirmationRequired) {
    openVerification(email);
    return;
  }
  await loadAccount();
});
handleForm('#signin-form', async () => {
  await request('account/signin', { email: $('#signin-email').value, password: $('#signin-password').value });
  $('#signin-password').value = '';
  await loadAccount();
});

function openApp(view) {
  $('#welcome').hidden = true;
  $('#student-app').hidden = false;
  $('#profile-shortcut').hidden = false;
  $('#account-menu-name').textContent = profile.name;
  $('#menu-teacher-settings').hidden = !isTeacher;
  $('#create-class-from-lobby').hidden = !isTeacher;
  const initial = Array.from(profile.name)[0].toUpperCase();
  $('#header-initial').textContent = initial;
  $('#greeting-name').textContent = profile.name;
  $('#profile-avatar').textContent = initial;
  $('#profile-name').textContent = profile.name;
  $('#profile-goal').textContent = profile.grade + ' · ' + profile.exam;
  $('#stat-exam').textContent = profile.exam;
  setView(view);
}

function hideAccountChrome() {
  $('#profile-shortcut').hidden = true;
  setAccountMenu(false);
}

function setAccountMenu(open) {
  $('#account-menu').hidden = !open;
  $('#profile-shortcut').setAttribute('aria-expanded', String(open));
}

function setView(view) {
  const isProfile = view === 'profile';
  const isTeacherSettings = view === 'teacher-settings' && isTeacher;
  const isTeacherCreate = view === 'teacher-create' && isTeacher;
  $('#classes-view').hidden = isProfile || isTeacherSettings || isTeacherCreate;
  $('#profile-view').hidden = !isProfile;
  $('#teacher-settings-view').hidden = !isTeacherSettings;
  $('#teacher-create-view').hidden = !isTeacherCreate;
  if (isProfile) renderHistory();
  else if (isTeacherCreate) loadTeacherSettings();
  else refreshClasses();
  window.scrollTo({ top: 0, behavior: 'auto' });
}

$('#cancel-edit').onclick = () => openApp('profile');
$('#profile-shortcut').onclick = () => {
  if (profile) setAccountMenu($('#account-menu').hidden);
};
$('#menu-classes').onclick = () => { setAccountMenu(false); openApp('classes'); };
$('#menu-profile').onclick = () => { setAccountMenu(false); openApp('profile'); };
$('#menu-student-settings').onclick = () => { setAccountMenu(false); openWelcome('signup', true); };
$('#menu-teacher-settings').onclick = () => { setAccountMenu(false); openApp('teacher-settings'); };
document.addEventListener('click', event => {
  if (!$('#account-menu').hidden && !event.target.closest('#account-menu') && !event.target.closest('#profile-shortcut')) setAccountMenu(false);
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !$('#account-menu').hidden) {
    setAccountMenu(false);
    $('#profile-shortcut').focus();
  }
});
$('#verified-email').onclick = () => {
  const email = $('#verification-email').textContent;
  openWelcome('signin');
  $('#signin-email').value = email;
  $('#signin-password').focus();
};
$('#resend-verification').onclick = async () => {
  const button = $('#resend-verification');
  button.disabled = true;
  $('#verification-message').textContent = '';
  try {
    await request('account/resend-confirmation', { email: $('#verification-email').textContent });
    $('#verification-message').textContent = 'A new verification email is on its way.';
  } catch (error) {
    $('#verification-message').textContent = error.message;
  } finally {
    button.disabled = false;
  }
};
async function signOut(button) {
  button.disabled = true;
  try {
    await request('account/signout', {});
    accountRevision++;
    profile = null;
    isTeacher = false;
    classes = [];
    openWelcome('signin');
  } catch (error) {
    // The server clears the browser session even when remote revocation fails.
    accountRevision++;
    profile = null;
    isTeacher = false;
    classes = [];
    openWelcome('signin');
    $('#signin-message').textContent = error.message;
  } finally {
    button.disabled = false;
  }
}
$('#menu-signout').onclick = () => signOut($('#menu-signout'));

const teacherDefaultsKey = 'mathfox-teacher-class-defaults';
function checkedValue(name) {
  return document.querySelector('input[name="' + name + '"]:checked')?.value;
}
function selectRadio(name, value) {
  const input = document.querySelector('input[name="' + name + '"][value="' + CSS.escape(value) + '"]');
  if (input) input.checked = true;
}
function loadTeacherSettings() {
  if (!isTeacher) return;
  $('#teacher-settings-note').textContent = '';
  try {
    const saved = JSON.parse(localStorage.getItem(teacherDefaultsKey) || 'null');
    if (saved) {
      selectRadio('teacher-grade', saved.grade);
      selectRadio('teacher-exam', saved.exam);
      $('#teacher-remember-settings').checked = true;
    }
  } catch { localStorage.removeItem(teacherDefaultsKey); }
}
$('#teacher-settings-form').onsubmit = async event => {
  event.preventDefault();
  if (!isTeacher) return;
  const button = $('#teacher-create-class');
  if (button.disabled) return;
  const details = {
    topic: $('#teacher-topic').value.trim(),
    introduction: $('#teacher-description').value.trim(),
    question: $('#teacher-question').value.trim(),
    teacherGuidance: $('#teacher-ai-guidance').value.trim(),
    grade: checkedValue('teacher-grade'),
    exam: checkedValue('teacher-exam')
  };
  button.disabled = true;
  $('#teacher-settings-note').textContent = 'Creating your live class…';
  try {
    await request('lesson', details);
    if ($('#teacher-remember-settings').checked) {
      localStorage.setItem(teacherDefaultsKey, JSON.stringify({ grade: details.grade, exam: details.exam }));
    } else localStorage.removeItem(teacherDefaultsKey);
    $('#teacher-settings-note').textContent = 'Your class is live.';
    if ($('#teacher-open-board').checked) location.assign('/classroom');
    else {
      $('#teacher-topic').value = '';
      $('#teacher-description').value = '';
      $('#teacher-question').value = '';
      $('#teacher-ai-guidance').value = '';
      refreshClasses();
      if (teacherClassDialog?.open) {
        teacherClassDialog.close();
        openApp('classes');
      }
    }
  } catch (error) {
    $('#teacher-settings-note').textContent = error.message;
  } finally { button.disabled = false; }
};

function ensureTeacherPages() {
  const settings = $('#teacher-settings-view');
  const form = $('#teacher-settings-form');
  const createView = document.createElement('div');
  createView.id = 'teacher-create-view';
  createView.hidden = true;
  createView.innerHTML = '<div class="dashboard-heading teacher-heading"><div><p class="eyebrow">CREATE A CLASS</p><h1>New live maths class</h1><p>Choose the class details before opening your AI teaching desk.</p></div><button id="back-to-teacher-settings" class="outline" type="button">Teacher settings</button></div>';
  settings.after(createView);
  createView.append(form);
  teacherClassFormHome = createView;
  teacherClassDialog = document.createElement('dialog');
  teacherClassDialog.id = 'teacher-class-dialog';
  teacherClassDialog.className = 'teacher-class-dialog';
  teacherClassDialog.innerHTML = '<div class="dialog-head"><div><p class="eyebrow">CREATE A CLASS</p><h2>New live maths class</h2><p>Choose the details, then open your teaching desk.</p></div><button id="close-teacher-class-dialog" class="icon-button" type="button" aria-label="Close class creator"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></div>';
  document.body.append(teacherClassDialog);
  teacherClassDialog.addEventListener('close', () => teacherClassFormHome.append(form));
  $('#close-teacher-class-dialog').onclick = () => teacherClassDialog.close();
  settings.querySelector('.teacher-heading .eyebrow').textContent = 'TEACHER WORKSPACE';
  settings.querySelector('.teacher-heading h1').textContent = 'Teacher settings';
  settings.querySelector('.teacher-heading p:not(.eyebrow)').textContent = 'Set up your board and teaching workspace preferences.';
  const preferences = document.createElement('section');
  preferences.className = 'teacher-settings-card';
  preferences.innerHTML = '<div class="settings-section"><p class="eyebrow">CLASSROOM APPEARANCE</p><h2>Board color</h2><p class="settings-copy">This preference is saved on this device and used in your teaching desk.</p><div class="radio-grid compact"><label><input type="radio" name="board-theme" value="navy" checked> <span>Navy</span></label><label><input type="radio" name="board-theme" value="slate"> <span>Slate</span></label><label><input type="radio" name="board-theme" value="forest"> <span>Forest</span></label><label><input type="radio" name="board-theme" value="paper"> <span>White</span></label></div></div><div class="settings-section"><p class="eyebrow">LIVE CLASS</p><h2>Create your next class</h2><p class="settings-copy">Topic, level, exam goal and private AI guidance are filled in only when you create a new class.</p><button id="open-class-creator" class="primary" type="button"><i class="fa-solid fa-plus" aria-hidden="true"></i> Create new class</button></div>';
  settings.append(preferences);
  $('#open-class-creator').onclick = () => openTeacherClassModal();
  $('#back-to-teacher-settings').onclick = () => openApp('teacher-settings');
  document.querySelectorAll('input[name="board-theme"]').forEach(input => input.onchange = () => {
    try { localStorage.setItem('mathfox-board-theme', input.value); } catch {}
  });
  try { selectRadio('board-theme', localStorage.getItem('mathfox-board-theme') || 'navy'); } catch {}
}
function openTeacherClassModal() {
  if (!isTeacher || !teacherClassDialog) return;
  teacherClassDialog.append($('#teacher-settings-form'));
  teacherClassDialog.showModal();
  $('#teacher-topic').focus();
}
ensureTeacherPages();
$('#create-class-from-lobby').onclick = () => openTeacherClassModal();

function classCard(item) {
  const card = create('article', undefined, 'class-card');
  const top = create('div', undefined, 'class-top');
  const icon = create('div', undefined, 'class-icon');
  const symbol = create('i', undefined, 'fa-solid fa-chalkboard-user');
  symbol.setAttribute('aria-hidden', 'true');
  icon.append(symbol);
  top.append(icon, create('span', '● LIVE', 'class-badge live'));
  card.append(top, create('h3', item.title));
  if (item.description) card.append(create('p', item.description));
  const meta = create('div', undefined, 'class-meta');
  for (const label of [item.grade || 'All levels', item.exam || 'All goals']) meta.append(create('span', label));
  const link = create('button', 'Join class', 'class-link');
  link.type = 'button';
  link.onclick = async () => {
    link.disabled = true;
    try { await request('class/join', { id: item.id }); location.assign('/classroom'); }
    catch (error) { link.disabled = false; alert(error.message); }
  };
  card.append(meta, link);
  return card;
}

function renderClasses() {
  const root = $('#live-classes');
  const grade = $('#grade-filter').value;
  const exam = $('#exam-filter').value;
  const filtered = classes.filter(item =>
    (!grade || item.grade === 'All levels' || item.grade === grade) &&
    (!exam || item.exam === 'All goals' || item.exam === exam));
  root.replaceChildren(...filtered.map(classCard));
  if (!filtered.length) root.append(create('div', classesStatus ||
    (classes.length ? 'No live classes match these filters.' : 'No classes are live right now.'), 'empty-card'));
}

let classRequest = 0;
async function refreshClasses() {
  const revision = accountRevision;
  const requestId = ++classRequest;
  try {
    const live = await request('classes');
    if (revision !== accountRevision || requestId !== classRequest) return;
    classes = live;
    classesStatus = '';
  } catch (error) {
    if (revision !== accountRevision || requestId !== classRequest) return;
    if (error.status === 401) return loadAccount().catch(showSignInError);
    classes = [];
    classesStatus = error.message;
  }
  renderClasses();
}

for (const id of ['#grade-filter', '#exam-filter']) $(id).onchange = renderClasses;
$('#clear-filters').onclick = () => {
  $('#grade-filter').value = '';
  $('#exam-filter').value = '';
  renderClasses();
};
setInterval(() => {
  if (profile && !$('#student-app').hidden && !$('#classes-view').hidden) refreshClasses();
}, 15000);

async function renderHistory() {
  const revision = accountRevision;
  const list = $('#history-list');
  list.replaceChildren(create('div', 'Loading lesson history…', 'empty-card'));
  let visits;
  try { visits = await request('history'); }
  catch (error) {
    if (revision !== accountRevision) return;
    if (error.status === 401) return loadAccount().catch(showSignInError);
    list.replaceChildren(create('div', error.message, 'empty-card'));
    return;
  }
  if (revision !== accountRevision) return;
  list.replaceChildren();
  $('#stat-visits').textContent = String(visits.length);
  $('#stat-topic').textContent = visits[0]?.topic || '—';
  if (!visits.length) list.append(create('div', 'Your lesson notes will appear here after you join a live class.', 'empty-card'));
  for (const visit of visits) {
    const row = create('article', undefined, 'history-item');
    const icon = create('div', undefined, 'class-icon');
    const symbol = create('i', undefined, 'fa-solid fa-book-open');
    symbol.setAttribute('aria-hidden', 'true');
    icon.append(symbol);
    const info = create('div', undefined, 'history-info');
    info.append(create('strong', visit.topic), create('p', new Date(visit.at).toLocaleDateString()));
    const button = create('button', 'View notes', 'text-button');
    button.onclick = () => showHistory(visit);
    row.append(icon, info, button);
    list.append(row);
  }
}

function showHistory(visit) {
  $('#history-title').textContent = visit.topic;
  $('#history-date').textContent = new Date(visit.at).toLocaleString();
  const body = $('#history-body');
  body.replaceChildren();
  if (visit.rows.length) body.append(create('div', visit.rows.map(row => row.text).join('\n'), 'saved-board'));
  if (visit.working) body.append(create('p', visit.working, 'saved-notes'));
  if (!visit.rows.length && !visit.working) body.append(create('p', 'No board notes were recorded for this lesson.', 'form-note'));
  $('#history-dialog').showModal();
}
$('#close-history').onclick = () => $('#history-dialog').close();

function showSignInError(error) {
  accountRevision++;
  profile = null;
  classes = [];
  openWelcome('signin');
  if (error.status !== 401) $('#signin-message').textContent = error.message;
}

loadAccount().catch(showSignInError);
