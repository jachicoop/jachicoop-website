'use strict';

(() => {
  let session = { isAdmin: false, needsSetup: false, available: false };
  let content = { posts: [], slides: null, slidesRevision: null };

  async function request(path, { method = 'GET', body } = {}) {
    const isForm = body instanceof FormData;
    let response;
    try {
      response = await fetch(path, {
        method, credentials: 'same-origin', cache: 'no-store',
        headers: body && !isForm ? { 'Content-Type': 'application/json' } : undefined,
        body: body && !isForm ? JSON.stringify(body) : body,
      });
    } catch {
      throw new Error('서버에 연결할 수 없습니다.');
    }
    const result = await response.json().catch(() => null);
    if (!response.ok || !result) {
      if (response.status === 401 && path !== '/api/session') void reloadSession();
      const error = new Error(result?.error || '서버에 연결할 수 없습니다.');
      error.status = response.status;
      throw error;
    }
    return result;
  }

  async function reloadSession() {
    try {
      session = { ...await request('/api/session'), available: true };
    } catch {
      session = { isAdmin: false, needsSetup: false, available: false };
    }
    window.dispatchEvent(new Event('jachicoop-session'));
    window.dispatchEvent(new Event('jachicoop-auth'));
  }

  async function reload() {
    const next = await request('/api/content').catch(() => null);
    if (next) {
      content = next;
      window.dispatchEvent(new Event('jachicoop-content'));
    }
  }

  const server = {
    request, reload, reloadSession,
    get isAdmin() { return session.isAdmin === true; },
    get session() { return { ...session }; },
    get content() { return content; },
    ready: Promise.all([reloadSession(), reload()]),
  };
  window.jachicoopServer = server;
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) void Promise.all([reloadSession(), reload()]);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void Promise.all([reloadSession(), reload()]);
  });

  const importButton = document.querySelector('[data-admin-import]');
  const importStatus = document.querySelector('[data-admin-import-status]');
  if (!importButton) return;

  function availableImport() {
    const existing = new Set(content.posts.map(({ id }) => id));
    const priorPosts = window.jachicoopLegacyPosts?.() || [];
    return {
      posts: priorPosts.filter(({ id }) => !existing.has(id)),
      slides: content.slides ? null : window.jachicoopLegacySlides?.(),
    };
  }

  function syncImport() {
    if (!server.isAdmin) {
      importButton.hidden = true;
      importStatus.hidden = true;
      return;
    }
    const prior = availableImport();
    importButton.hidden = !(prior.posts.length || prior.slides?.length);
  }

  importButton.addEventListener('click', async () => {
    if (!server.isAdmin || importButton.disabled) return;
    importButton.disabled = true;
    importStatus.hidden = false;
    importStatus.textContent = '기존 작업을 가져오는 중입니다.';
    const prior = availableImport();
    let successes = 0;
    let failures = 0;
    for (const original of prior.posts) {
      try {
        if (original.deleted) {
          await request('/api/post', { method: 'DELETE', body: { id: original.id, expected: null } });
        } else {
          const post = { ...original, attachments: original.attachments || [] };
          const form = new FormData();
          form.set('payload', JSON.stringify({ post, expected: null }));
          for (const { id, name } of post.attachments) {
            const file = await window.jachicoopLegacyAttachment?.(id);
            if (!(file instanceof Blob)) throw new Error('첨부파일을 찾을 수 없습니다.');
            form.set(id, file, name);
          }
          await request('/api/post', { method: 'POST', body: form });
        }
        successes++;
      } catch { failures++; }
    }
    if (prior.slides?.length) {
      try {
        await request('/api/slides', { method: 'PUT', body: { expected: null, slides: prior.slides } });
        successes++;
      } catch { failures++; }
    }
    await reload();
    importStatus.textContent = failures ? `${successes}건을 가져왔습니다. 가져오지 못한 작업이 ${failures}건 있습니다.` : '기존 작업을 가져왔습니다.';
    importButton.disabled = false;
    syncImport();
  });

  window.addEventListener('jachicoop-session', syncImport);
  window.addEventListener('jachicoop-content', syncImport);
  void server.ready.then(syncImport);
})();
