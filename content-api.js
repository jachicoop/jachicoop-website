'use strict';

(() => {
  let session = { isAdmin: false, available: false };
  let content = { posts: [], slides: null, slidesRevision: null };
  const connection = import('./firebase-config.js').then(async ({ default: config }) => {
    if (!config) throw new Error('Firebase 연결 설정을 기다리고 있습니다.');
    const { connectFirestore } = await import('./firestore-cms.js');
    return connectFirestore(config);
  });

  async function request(path, options) {
    const store = await connection;
    return store.request(path, options);
  }

  async function reloadSession() {
    try {
      session = { ...await request('/api/session'), available: true };
    } catch (error) {
      session = { isAdmin: false, available: false, message: error.message };
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
    let localFiles = 0;
    for (const original of prior.posts) {
      try {
        if (original.deleted) {
          await request('/api/post', { method: 'DELETE', body: { id: original.id, expected: null } });
        } else {
          const allAttachments = original.attachments ?? [];
          const attachments = allAttachments.filter(({ url }) => typeof url === 'string' && url.startsWith('https://'));
          const post = { ...original, attachments };
          await request('/api/post', { method: 'POST', body: { post, expected: null } });
          localFiles += allAttachments.length - attachments.length;
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
    const messages = [`${successes}건을 가져왔습니다.`];
    if (failures) messages.push(`가져오지 못한 작업이 ${failures}건 있습니다.`);
    if (localFiles) messages.push(`이 브라우저에 보관된 첨부파일 ${localFiles}개는 공개 링크로 다시 연결해 주세요.`);
    importStatus.textContent = messages.join(' ');
    importButton.disabled = false;
    syncImport();
  });

  window.addEventListener('jachicoop-session', syncImport);
  window.addEventListener('jachicoop-content', syncImport);
  void server.ready.then(syncImport);
})();
