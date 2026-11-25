'use strict';

const adminServer = window.jachicoopServer;
const adminLogin = document.querySelector('[data-admin-login]');
const loginSubmit = adminLogin?.querySelector('button[type="submit"]');
const adminLogouts = document.querySelectorAll('[data-admin-logout]');
const adminStatus = document.querySelector('[data-admin-login-status]');
let authPending = false;

function isAdminMode() {
  return adminServer?.isAdmin === true;
}

function syncAdminControls() {
  const active = isAdminMode();
  for (const control of document.querySelectorAll('[data-admin-only]')) control.hidden = !active;
  for (const view of document.querySelectorAll('[data-admin-signed-out]')) view.hidden = active;
  if (loginSubmit) loginSubmit.disabled = authPending || !adminServer?.session.available;
  for (const button of adminLogouts) button.disabled = authPending;
}

function showAdminStatus(message, status = adminStatus) {
  if (!status) return;
  status.textContent = message;
  status.hidden = !message;
}

async function changeAdminSession(method, body, status) {
  authPending = true;
  showAdminStatus('', status);
  syncAdminControls();
  try {
    await adminServer.request('/api/session', body ? { method, body } : { method });
    if (method === 'POST') adminLogin?.reset();
    await adminServer.reloadSession();
    if ((method === 'POST') !== isAdminMode()) {
      showAdminStatus('로그인 상태를 확인할 수 없습니다. 다시 시도해 주세요.', status);
    } else if (method === 'POST') {
      location.reload();
    }
  } catch (error) {
    showAdminStatus(error.message || '로그인 상태를 변경하지 못했습니다.', status);
  } finally {
    authPending = false;
    syncAdminControls();
  }
}

adminLogin?.addEventListener('submit', (event) => {
  event.preventDefault();
  if (authPending || isAdminMode() || !adminServer?.session.available) return;
  const { email, password } = adminLogin.elements;
  void changeAdminSession('POST', {
    email: email.value.trim(),
    password: password.value,
  });
});
for (const button of adminLogouts) {
  button.addEventListener('click', () => {
    if (authPending || !isAdminMode()) return;
    const status = button.parentElement.querySelector('[data-admin-logout-status]') || adminStatus;
    void changeAdminSession('DELETE', undefined, status);
  });
}

syncAdminControls();
window.addEventListener('jachicoop-session', syncAdminControls);
Promise.resolve(adminServer?.ready).then(() => {
  syncAdminControls();
  if (adminLogin && !adminServer?.session.available) {
    showAdminStatus(adminServer?.session.message || '관리자 로그인 서비스에 연결할 수 없습니다.');
  }
}).catch(() => {
  syncAdminControls();
  showAdminStatus('관리자 로그인 서버에 연결할 수 없습니다.');
});
window.addEventListener('preview-posts-updated', syncAdminControls);

for (const filters of document.querySelectorAll('[data-board-filters]')) {
  const board = filters.closest('.subpage');
  const count = board.querySelector('[data-board-count]');
  const empty = board.querySelector('[data-board-empty]');
  const noPostsMessage = empty.textContent;
  const {query, topic, from, to} = filters.elements;
  const normalize = (text) => text.normalize('NFKC').toLocaleLowerCase('ko-KR');
  let indexed = [];

  function refreshIndex() {
    indexed = [...board.querySelectorAll('[data-board-post]')].map((record) => ({
      record, text: normalize(record.dataset.search),
    }));
    updateResults();
  }

  function updateResults() {
    const invalidRange = Boolean(from.value && to.value && from.value > to.value);
    to.setCustomValidity(invalidRange ? '종료 날짜는 시작 날짜보다 빠를 수 없습니다.' : '');
    if (invalidRange) {
      count.textContent = '시작 날짜와 종료 날짜를 확인해 주세요.';
      return;
    }
    const words = normalize(query.value.trim()).split(/\s+/).filter(Boolean);
    let visible = 0;
    for (const {record, text} of indexed) {
      const {date, topic: postTopic} = record.dataset;
      const matches = (!topic.value || postTopic === topic.value)
        && (!from.value || date >= from.value)
        && (!to.value || date <= to.value)
        && words.every((word) => text.includes(word));
      record.hidden = !matches;
      if (matches) visible++;
    }
    count.textContent = `게시글 ${visible}건`;
    empty.textContent = indexed.length ? '조건에 맞는 게시글이 없습니다. 검색어나 필터를 바꿔 보세요.' : noPostsMessage;
    empty.hidden = visible !== 0;
  }

  filters.addEventListener('submit', (event) => {
    event.preventDefault();
    updateResults();
  });
  filters.addEventListener('input', updateResults);
  filters.addEventListener('change', updateResults);
  filters.addEventListener('reset', () => setTimeout(updateResults, 0));
  window.addEventListener('preview-posts-updated', refreshIndex);
  refreshIndex();
}

for (const photo of document.images) watchPhoto(photo);

const slideFields = ['title', 'date', 'place', 'alt', 'post', 'article'];
const requiredSlideFields = ['title', 'date', 'place'];
const legacySlideKey = 'jachicoop-preview-hero-v2';

function slideHttpsUrl(value) {
  if (typeof value !== 'string' || value.length > 1200) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch {
    return '';
  }
}

function slideImageSource(value) {
  if (typeof value !== 'string') return '';
  if (value.length <= 700000 && /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(value)) return value;
  if (/^[a-z0-9_-]+\.(?:png|jpe?g|webp)$/i.test(value)) return value;
  return slideHttpsUrl(value);
}

function normalizeSlide(slide, builtInPosts) {
  if (!slide || !requiredSlideFields.every((name) => typeof slide[name] === 'string' && slide[name].trim())) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(slide.date)) return null;
  const post = typeof slide.post === 'string' && (/^post-[a-z0-9-]+\.html$/.test(slide.post) || /^entry\.html\?id=local-[a-z0-9-]+$/.test(slide.post))
    ? slide.post
    : '';
  const builtIn = builtInPosts.get(post);
  const article = slideHttpsUrl(slide.article ?? builtIn?.sourceUrl);
  if (slide.article && !article) return null;
  let imageOverride = slideImageSource(slide.imageOverride);
  let alt = typeof slide.alt === 'string' ? slide.alt : '';
  if (!Object.hasOwn(slide, 'imageOverride')) {
    const oldImage = slideImageSource(slide.image);
    // A stored copy of the original post image keeps following that post after import.
    if (oldImage !== slideImageSource(builtIn?.image)) imageOverride = oldImage;
    else if (alt === builtIn?.alt) alt = '';
  }
  const normalized = { title: slide.title, date: slide.date, place: slide.place, imageOverride, alt, post, article };
  if (Number.isSafeInteger(slide.registeredAt) && slide.registeredAt > 0) normalized.registeredAt = slide.registeredAt;
  return normalized;
}

window.jachicoopLegacySlides = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(legacySlideKey));
    if (!Array.isArray(saved) || !saved.length) return null;
    const postCatalog = JSON.parse(document.querySelector('#post-catalog')?.textContent ?? '[]');
    const builtInPosts = new Map(postCatalog.map((post) => [`post-${post.id}.html`, post]));
    const normalized = saved.map((slide) => normalizeSlide(slide, builtInPosts));
    return normalized.every(Boolean) ? normalized : null;
  } catch {
    return null;
  }
};

const carousel = document.querySelector('.hero-carousel');
if (carousel) setupCarousel(carousel);

function setupCarousel(section) {
  const defaults = JSON.parse(document.querySelector('#hero-slides').textContent);
  const editor = document.querySelector('#slide-editor');
  const form = document.querySelector('#edit-slides');
  const editorStatus = document.querySelector('#editor-status');
  const [previous, next] = section.querySelectorAll('.slide-arrow');
  const photos = [...section.querySelectorAll('[data-slide-image]')];
  const title = section.querySelector('#slide-title');
  const meta = section.querySelector('#slide-meta');
  const postLink = section.querySelector('#slide-post');
  const articleLink = section.querySelector('#slide-article');
  const status = section.querySelector('#slide-status');
  const dots = section.querySelector('.slide-dots');
  const timing = section.querySelector('.slide-timing');
  const progress = timing.querySelector('.slide-progress span');
  const playback = timing.querySelector('.slide-playback');
  const editorTrigger = document.querySelector('[data-open-editor]');
  const fields = form.querySelector('[data-slide-fields]');
  const closeEditor = editor.querySelector('[data-close-editor]');
  const deleteButton = form.querySelector('[data-delete-slide]');
  const removeImage = form.querySelector('[data-existing-slide-image]');
  const resetButton = editor.querySelector('[data-reset-slides]');
  const attachment = window.jachicoopImages.setup(form.querySelector('[data-image-attachment]'), adminServer, syncImageControls);
  const builtInPosts = new Map([...form.elements.post.options]
    .filter((option) => option.value)
    .map((option) => [option.value, {
      id: option.dataset.postId, title: option.textContent, sourceUrl: option.dataset.articleUrl,
      image: option.dataset.postImage, alt: option.dataset.postAlt,
    }]));
  const knownPosts = new Map();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let current = 0;
  let editingRevision = null;
  let displayedRevision = null;
  let saving = false;
  let playing = !reducedMotion.matches;
  let countdown;

  function serverSlides() {
    const saved = adminServer?.content.slides;
    if (Array.isArray(saved)) {
      const normalized = saved.map((slide) => normalizeSlide(slide, builtInPosts));
      if (normalized.every(Boolean)) return normalized.sort((a, b) => (b.registeredAt ?? 0) - (a.registeredAt ?? 0));
    }
    return defaults.map((slide) => ({...slide}));
  }

  let slides = serverSlides();

  async function persist(updated) {
    try {
      const saved = await adminServer.request('/api/slides', { method: 'PUT', body: { expected: editingRevision, slides: updated } });
      slides = updated;
      editingRevision = saved.revision;
      displayedRevision = saved.revision;
    } catch (error) {
      if (error.status === 401 || error.status === 403) void adminServer.reloadSession().catch(() => {});
      throw error;
    }
    await adminServer.reload().catch(() => {});
  }

  function syncSlides() {
    section.hidden = slides.length === 0;
    while (photos.length > slides.length) photos.pop().remove();
    slides.forEach((slide, index) => {
      let photo = photos[index];
      if (!photo) {
        photo = document.createElement('img');
        photo.setAttribute('data-slide-image', '');
        photo.width = 940;
        photo.height = 626;
        photo.hidden = true;
        previous.before(photo);
        photos.push(photo);
        watchPhoto(photo);
      }
      const linked = knownPosts.get(slide.post);
      const source = slide.imageOverride || linked?.image || '';
      if ((photo.getAttribute('src') ?? '') !== source) {
        photo.classList.remove('photo-unavailable');
        if (source) photo.src = source;
        else photo.removeAttribute('src');
      }
      photo.alt = source ? (slide.alt || (!slide.imageOverride && linked?.alt) || `${slide.title} 이미지`) : '';
      let dot = dots.children[index];
      if (!dot) {
        dot = document.createElement('button');
        dot.type = 'button';
        dot.dataset.slide = String(index);
        dot.append(document.createElement('span'));
        dots.append(dot);
      }
      dot.setAttribute('aria-label', `${slide.title} 보기`);
    });
    while (dots.children.length > slides.length) dots.lastElementChild.remove();
    [previous, next, dots, timing].forEach((element) => { element.hidden = slides.length < 2; });
  }

  function setSlideLink(link, url) {
    link.hidden = !url;
    if (url) link.href = url;
    else link.removeAttribute('href');
  }

  function syncPlayback() {
    playback.textContent = playing ? '자동 재생 일시정지' : '자동 재생 시작';
    const focusedLink = postLink === document.activeElement || articleLink === document.activeElement;
    if (!countdown || countdown.playState === 'finished') return;
    if (playing && !document.hidden && !editor.open && !focusedLink) {
      if (countdown.playState !== 'running') countdown.play();
    } else if (countdown.playState !== 'paused') {
      countdown.pause();
    }
  }

  function restartCountdown() {
    countdown?.cancel();
    countdown = null;
    if (slides.length > 1) {
      countdown = progress.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: 10000 });
      countdown.onfinish = () => render(current + 1, false);
    }
    syncPlayback();
  }

  function render(index, announce = true) {
    restartCountdown();
    if (!slides.length) {
      current = 0;
      status.textContent = '';
      return;
    }
    current = ((index % slides.length) + slides.length) % slides.length;
    const slide = slides[current];
    photos.forEach((photo, i) => {
      photo.hidden = i !== current || !photo.hasAttribute('src');
    });
    title.textContent = slide.title;
    meta.textContent = `${slide.place} · ${slide.date.replaceAll('-', '.')}`;
    setSlideLink(postLink, knownPosts.has(slide.post) ? slide.post : '');
    setSlideLink(articleLink, slide.article);
    articleLink.parentElement.hidden = articleLink.hidden && postLink.hidden;
    [...dots.children].forEach((dot, i) => {
      if (i === current) dot.setAttribute('aria-current', 'true');
      else dot.removeAttribute('aria-current');
    });
    if (announce) status.textContent = `${slides.length}개 중 ${current + 1}번째 행사. ${slide.title}`;
  }

  function reloadSlides() {
    const nextRevision = adminServer?.content.slidesRevision ?? null;
    const changed = nextRevision !== displayedRevision;
    displayedRevision = nextRevision;
    slides = serverSlides();
    syncSlides();
    render(changed ? 0 : Math.min(current, slides.length - 1), false);
  }

  previous.addEventListener('click', () => render(current - 1));
  next.addEventListener('click', () => render(current + 1));
  playback.addEventListener('click', () => {
    playing = !playing;
    syncPlayback();
  });
  reducedMotion.addEventListener('change', () => {
    if (reducedMotion.matches) playing = false;
    syncPlayback();
  });
  section.addEventListener('focusin', syncPlayback);
  section.addEventListener('focusout', () => queueMicrotask(syncPlayback));
  document.addEventListener('visibilitychange', syncPlayback);
  dots.addEventListener('click', (event) => {
    const dot = event.target.closest('button[data-slide]');
    if (dot) render(Number(dot.dataset.slide));
  });
  section.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      render(current + (event.key === 'ArrowLeft' ? -1 : 1));
    }
  });

  function syncPostChoices() {
    const chooser = form.elements.post;
    const selected = chooser.value;
    const deleted = window.jachicoopDeletedPostIds?.() ?? new Set();
    const edits = new Map((window.jachicoopPosts?.() ?? []).map((post) => [post.id, post]));
    knownPosts.clear();
    function include(href, post) {
      if (!deleted.has(post.id)) knownPosts.set(href, {...post, image: slideImageSource(post.image)});
    }
    for (const [href, original] of builtInPosts) include(href, edits.get(original.id) ?? original);
    for (const [id, post] of edits) {
      if (/^local-[a-z0-9-]+$/.test(id)) include(`entry.html?id=${encodeURIComponent(id)}`, post);
    }
    const choices = [...knownPosts].map(([href, post]) => new Option(post.title, href));
    chooser.replaceChildren(new Option('연결 안 함', ''), ...choices);
    chooser.value = knownPosts.has(selected) ? selected : '';
  }

  function syncImageControls() {
    const currentEdit = slides[Number(form.elements.slide.value)];
    removeImage.hidden = attachment.selected || !currentEdit?.imageOverride;
    if (removeImage.hidden) form.elements.removeImage.checked = false;
  }

  function populate(index) {
    if (!slides.length) index = 'new';
    const options = slides.map((slide, i) => new Option(slide.title, String(i)));
    options.push(new Option('새 슬라이드', 'new'));
    const picker = form.elements.slide;
    picker.replaceChildren(...options);
    picker.value = String(index);
    const selected = index === 'new' ? null : slides[index];
    slideFields.forEach((name) => { form.elements[name].value = selected?.[name] ?? ''; });
    if (!knownPosts.has(form.elements.post.value)) form.elements.post.value = '';
    form.elements.removeImage.checked = false;
    deleteButton.hidden = !selected;
    attachment.reset();
    editorStatus.textContent = '';
  }

  editorTrigger?.addEventListener('click', async () => {
    if (!isAdminMode() || editor.open) return;
    await adminServer.reloadSession().catch(() => {});
    if (!isAdminMode() || editor.open) return;
    await adminServer.reload().catch(() => {});
    if (!isAdminMode() || editor.open) return;
    syncPostChoices();
    reloadSlides();
    editingRevision = adminServer.content.slidesRevision ?? null;
    populate(current);
    editor.showModal();
    syncPlayback();
  });
  editor.querySelector('[data-new-slide]').addEventListener('click', () => {
    populate('new');
    form.elements.title.focus();
  });
  closeEditor.addEventListener('click', () => editor.close());
  editor.addEventListener('cancel', (event) => {
    if (saving) event.preventDefault();
  });
  editor.addEventListener('close', () => {
    attachment.reset();
    reloadSlides();
    if (editorTrigger && !editorTrigger.hidden) editorTrigger.focus({preventScroll: true});
  });
  form.elements.slide.addEventListener('change', () => {
    const chosen = form.elements.slide.value;
    populate(chosen === 'new' ? 'new' : Number(chosen));
  });
  async function saveEdit(update) {
    if (!isAdminMode() || !editor.open || saving) return;
    fields.disabled = closeEditor.disabled = saving = true;
    editorStatus.textContent = '저장하는 중입니다.';
    try {
      await update();
    } catch (error) {
      editorStatus.textContent = error.message;
    } finally {
      fields.disabled = closeEditor.disabled = saving = false;
    }
  }

  async function applySlides(updated, index, message) {
    await persist(updated);
    if (!editor.open) {
      reloadSlides();
      return;
    }
    syncSlides();
    render(index);
    populate(index);
    editorStatus.textContent = message;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!isAdminMode() || !editor.open || saving) return;
    const values = Object.fromEntries(slideFields.map((name) => [name, form.elements[name].value.trim()]));
    const slide = normalizeSlide(values, builtInPosts);
    if (!slide) {
      editorStatus.textContent = '행사 정보를 확인해 주세요. 외부 기사 주소는 https://로 시작해야 합니다.';
      return;
    }
    const adding = form.elements.slide.value === 'new';
    const index = adding ? 0 : Number(form.elements.slide.value);
    const original = adding ? null : slides[index];
    const previousImage = form.elements.removeImage.checked ? '' : original?.imageOverride ?? '';
    await saveEdit(async () => {
      if (adding && slides.length >= 50) throw new Error('메인 슬라이드는 최대 50개까지 저장할 수 있습니다.');
      if (slide.post && !knownPosts.has(slide.post)) throw new Error('연결할 게시글을 다시 선택해 주세요.');
      slide.imageOverride = await attachment.save() || previousImage;
      if (adding) slide.registeredAt = Math.max(Date.now(), (slides[0]?.registeredAt ?? 0) + 1);
      else if (original?.registeredAt) slide.registeredAt = original.registeredAt;
      const updated = [...slides];
      updated.splice(index, adding ? 0 : 1, slide);
      await applySlides(updated, index, adding ? '새 슬라이드를 첫 번째에 추가했습니다.' : '저장했습니다.');
    });
  });
  deleteButton.addEventListener('click', () => {
    if (!isAdminMode() || saving) return;
    const index = Number(form.elements.slide.value);
    const slide = slides[index];
    if (!slide || !window.confirm(`‘${slide.title}’ 슬라이드를 홈페이지에서 삭제할까요?`)) return;
    const updated = slides.filter((_, i) => i !== index);
    void saveEdit(() => applySlides(updated, Math.max(0, Math.min(index, updated.length - 1)), '슬라이드를 삭제했습니다.'));
  });
  resetButton.addEventListener('click', () => {
    void saveEdit(() => applySlides(defaults.map((slide) => ({...slide})), 0, '기본 설정으로 복원했습니다.'));
  });
  window.addEventListener('jachicoop-session', () => {
    if (!isAdminMode() && editor.open) editor.close();
  });
  window.addEventListener('jachicoop-content', () => {
    syncPostChoices();
    if (!editor.open) reloadSlides();
  });
  syncPostChoices();
  reloadSlides();
}

function watchPhoto(photo) {
  function showFallback() {
    if (photo.hasAttribute('data-slide-image')) photo.classList.add('photo-unavailable');
    else photo.hidden = true;
  }
  photo.addEventListener('error', showFallback);
  if (photo.getAttribute('src') && photo.complete && !photo.naturalWidth) showFallback();
}
