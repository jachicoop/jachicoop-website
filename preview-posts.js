'use strict';

(() => {
  const storagePrefix = 'jachicoop-preview-post:';
  const imageTypes = ['image/png', 'image/jpeg', 'image/webp'];
  const uploadLimitMiB = 20;
  const storedImageLimit = 480 * 1024;
  const attachmentLimit = 30 * 1024 * 1024;
  const attachmentTypes = /\.(pdf|hwp|hwpx|doc|docx|xls|xlsx|ppt|pptx|txt|zip)$/i;
  const postIdFormat = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  const attachmentStore = 'files';
  const boards = {
    activity: { title: '활동 기록', href: 'activity-board.html', date: '활동 날짜', image: '활동 사진' },
    recruitment: { title: '행사 신청', href: 'participation-guide.html', date: '행사 날짜', image: '모집 포스터' },
    publication: { title: '책과 발간물', href: 'publications-board.html', date: '발간 날짜', image: '표지 이미지' },
    notice: { title: '공지사항', href: 'notices.html', date: '공지 날짜', image: '첨부 이미지' },
  };
  const server = window.jachicoopServer;
  const isLocalId = (id) => id.startsWith('local-');
  const isAdmin = () => Boolean(server?.isAdmin);
  const params = new URLSearchParams(location.search);
  let attachmentDatabase;

  function todayInKorea() {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date());
    const date = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return `${date.year}-${date.month}-${date.day}`;
  }

  function httpsUrl(value) {
    try {
      const url = new URL(value);
      if (url.protocol === 'https:' && !url.username && !url.password) return url.href;
    } catch {
      return '';
    }
    return '';
  }

  function safeImage(value) {
    if (typeof value !== 'string') return '';
    const uploaded = /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i;
    if (value.length <= 700000 && uploaded.test(value)) return value;
    if (/^[a-z0-9_-]+\.(?:png|jpe?g|webp)$/i.test(value)) return value;
    return httpsUrl(value);
  }

  function dateLabel(value) {
    return typeof value === 'string' ? value.slice(0, 10).replaceAll('-', '.') : '';
  }

  function detailHref(id) {
    return isLocalId(id) ? `entry.html?id=${encodeURIComponent(id)}` : `post-${encodeURIComponent(id)}.html`;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (typeof text === 'string') node.textContent = text;
    return node;
  }

  function readLegacyPosts() {
    const posts = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key?.startsWith(storagePrefix)) continue;
        let post;
        try {
          post = JSON.parse(localStorage.getItem(key));
        } catch {
          continue;
        }
        if (!post || typeof post.id !== 'string' || !postIdFormat.test(post.id) || key !== storagePrefix + post.id) continue;
        if (post.deleted === true || (Object.hasOwn(boards, post.kind)
          && typeof post.title === 'string' && typeof post.topic === 'string' && typeof post.summary === 'string'
          && typeof post.date === 'string' && typeof post.publishedAt === 'string'
          && Array.isArray(post.paragraphs) && post.paragraphs.every((text) => typeof text === 'string'))) {
          posts.push(post);
        }
      }
    } catch {
      // Public content remains available when the browser blocks storage.
    }
    return posts;
  }

  const readPostEntries = () => Array.isArray(server?.content?.posts) ? server.content.posts : [];
  const readPosts = () => readPostEntries().filter((post) => !post.deleted);
  const deletedPostIds = (entries = readPostEntries()) => new Set(entries.filter((post) => post.deleted).map((post) => post.id));
  window.jachicoopPosts = readPosts;
  window.jachicoopDeletedPostIds = deletedPostIds;
  window.jachicoopLegacyPosts = readLegacyPosts;

  function newId(prefix) {
    return `${prefix}-${crypto.getRandomValues(new Uint32Array(3)).join('-')}`;
  }

  function attachmentsFor(post) {
    return Array.isArray(post?.attachments) ? post.attachments.filter((item) => item
      && typeof item.id === 'string' && /^file-\d+-\d+-\d+$/.test(item.id)
      && typeof item.name === 'string' && attachmentTypes.test(item.name)) : [];
  }

  function openAttachments() {
    if (!attachmentDatabase) {
      attachmentDatabase = new Promise((resolve, reject) => {
        const request = indexedDB.open('jachicoop-preview-attachments', 1);
        request.onupgradeneeded = () => request.result.createObjectStore(attachmentStore);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('첨부파일 보관함을 열 수 없습니다.'));
      }).catch((error) => {
        attachmentDatabase = undefined;
        throw error;
      });
    }
    return attachmentDatabase;
  }

  async function loadLegacyAttachment(id) {
    const database = await openAttachments();
    return new Promise((resolve, reject) => {
      const request = database.transaction(attachmentStore).objectStore(attachmentStore).get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  window.jachicoopLegacyAttachment = loadLegacyAttachment;

  function recruitmentClosed(post) {
    return Boolean(post.recruitment?.closed || (post.recruitment?.deadline && post.recruitment.deadline < todayInKorea()));
  }

  function recruitmentBadge(closed) {
    return el('span', `recruitment-status ${closed ? 'is-closed' : 'is-open'}`, closed ? '모집 마감' : '모집 중');
  }

  function photoFor(post, source, width, height) {
    const photo = el('img');
    photo.src = source;
    photo.alt = typeof post.alt === 'string' ? post.alt : post.title;
    photo.width = width;
    photo.height = height;
    photo.loading = 'lazy';
    photo.referrerPolicy = 'no-referrer';
    photo.addEventListener('error', () => { photo.hidden = true; });
    return photo;
  }

  function cardFor(post) {
    const card = el('article', 'story');
    Object.assign(card.dataset, {
      boardPost: '', postId: post.id, publishedAt: post.publishedAt, date: post.date,
      topic: post.topic, search: [post.title, post.topic, post.summary, ...post.paragraphs].join(' '),
    });
    const link = el('a', 'story-card');
    link.href = detailHref(post.id);
    link.setAttribute('aria-label', post.title);
    const photo = safeImage(post.image);
    const coverStyle = !photo ? 'story-type' : (post.kind === 'activity' ? '' : 'document-media');
    const cover = el('span', `story-media ${coverStyle}`.trim());
    cover.append(photo ? photoFor(post, photo, 680, 420) : el('span', '', boards[post.kind].title));
    const copy = el('div', 'story-copy');
    const meta = el('p', 'meta');
    const date = el('time', '', dateLabel(post.date));
    date.dateTime = post.date;
    const tags = el('span', 'meta-tags');
    tags.append(el('span', '', post.topic));
    if (post.kind === 'recruitment') tags.append(recruitmentBadge(recruitmentClosed(post)));
    meta.append(tags, date);
    copy.append(meta, el('h3', '', post.title), el('p', '', post.summary));
    link.append(cover, copy);
    card.append(link);
    return card;
  }

  function addBoardTopics(grid, cards) {
    const select = grid.closest('.subpage')?.querySelector('[data-board-filters] select[name="topic"]');
    if (!select) return;
    const current = select.value;
    for (const item of [...select.options]) if (item.value) item.remove();
    const topics = new Set(cards.map((card) => card.dataset.topic).filter(Boolean));
    for (const topic of [...topics].sort((a, b) => a.localeCompare(b, 'ko'))) {
      const option = el('option', '', topic);
      option.value = topic;
      select.append(option);
    }
    if ([...select.options].some((option) => option.value === current)) select.value = current;
  }

  const grids = [...document.querySelectorAll('.story-grid[data-local-board], .story-grid[data-home-newest]')]
    .map((grid) => ({ grid, original: [...grid.children] }));

  function drawGrids(posts, deleted) {
    for (const { grid, original } of grids) {
      const board = grid.dataset.localBoard;
      const local = board ? posts.filter((post) => post.kind === board) : posts;
      const existing = new Set(original.map((item) => item.dataset.postId));
      const edited = new Map(local.map((post) => [post.id, post]));
      const cards = original.filter((item) => !deleted.has(item.dataset.postId)).map((item) => {
        const updated = edited.get(item.dataset.postId);
        return updated ? cardFor(updated) : item;
      });
      cards.push(...local.filter((post) => !existing.has(post.id)).map(cardFor));
      cards.sort((a, b) => (b.dataset.publishedAt ?? '').localeCompare(a.dataset.publishedAt ?? ''));
      const limit = Number(grid.dataset.limit);
      const displayed = limit > 0 ? cards.slice(0, limit) : cards;
      if (limit > 0) for (const card of displayed) card.hidden = false;
      grid.replaceChildren(...displayed);
      if (board) addBoardTopics(grid, cards);
    }
  }

  function addFacts(body, facts, closed) {
    const list = el('dl', 'entry-facts');
    for (const [label, value] of facts) {
      if (typeof value !== 'string' || !value) continue;
      const fact = el('div');
      fact.append(el('dt', '', label), el('dd', '', value));
      list.append(fact);
    }
    if (typeof closed === 'boolean') {
      const fact = el('div');
      const value = el('dd');
      value.append(recruitmentBadge(closed));
      fact.append(el('dt', '', '모집 상태'), value);
      list.append(fact);
    }
    if (list.children.length) body.append(list);
  }

  function appendLink(actions, rawUrl, label, style = 'text-link', allowLocal = false) {
    const url = httpsUrl(rawUrl) || (allowLocal && /^[a-z0-9_-]+\.(?:pdf|png|jpe?g|webp)$/i.test(rawUrl) ? rawUrl : '');
    if (!url) return;
    const link = el('a', style, label);
    link.href = url;
    link.rel = 'noreferrer';
    actions.append(link);
    return link;
  }

  const entryPage = document.querySelector('[data-local-post]');
  const initialEntry = entryPage?.cloneNode(true);
  const initialTitle = document.title;
  let entryChanged = false;

  function drawAttachments(body, attachments) {
    if (!attachments.length) return;
    const section = el('section', 'post-attachments');
    const items = el('ul');
    for (const { id, name } of attachments) {
      const item = el('li');
      const link = el('a', 'button button-outline button-small', `${name} 내려받기`);
      link.href = `/api/file/${encodeURIComponent(id)}`;
      link.download = name;
      item.append(link);
      items.append(item);
    }
    section.append(el('h2', '', '첨부파일'), items);
    body.append(section);
  }

  function drawDeletedEntry(page) {
    entryChanged = true;
    document.title = '삭제된 게시글 | 길잡이';
    page.querySelector('[data-entry-title]').textContent = '삭제된 게시글';
    const crumb = page.querySelector('[data-entry-crumb]');
    if (crumb) crumb.textContent = '삭제된 게시글';
    page.querySelector('[data-entry-meta]').hidden = true;
    page.querySelector('[data-entry-summary]').hidden = true;
    page.querySelector('[data-entry-edit]')?.remove();
    page.querySelector('[data-entry-body]').replaceChildren(el('p', '', '이 게시글은 삭제되었습니다.'));
  }

  function drawEntry(page, post) {
    if (!page || !post) return;
    entryChanged = true;
    const board = boards[post.kind];
    document.title = `${post.title} | 길잡이`;
    page.querySelector('[data-entry-title]').textContent = post.title;
    const crumb = page.querySelector('[data-entry-crumb]');
    if (crumb) crumb.textContent = post.title;
    const boardLink = page.querySelector('[data-entry-board]');
    boardLink.href = board.href;
    boardLink.textContent = board.title;
    const meta = page.querySelector('[data-entry-meta]');
    meta.replaceChildren(el('span'), ` ${post.topic} · ${dateLabel(post.date)}`);
    meta.hidden = false;
    const summary = page.querySelector('[data-entry-summary]');
    summary.textContent = post.summary;
    summary.hidden = !post.summary;
    const body = page.querySelector('[data-entry-body]');
    const nav = page.querySelector('[data-post-nav]');
    nav.querySelector('[data-post-back]').href = board.href;
    if (!nav.querySelector('[data-entry-edit]')) {
      const edit = el('a', 'button button-outline button-small', '글 수정');
      edit.href = `admin-posts.html?edit=${encodeURIComponent(post.id)}`;
      edit.dataset.entryEdit = '';
      edit.dataset.adminOnly = '';
      edit.hidden = !isAdmin();
      nav.append(edit);
    }
    body.replaceChildren();
    const image = safeImage(post.image);
    if (image) {
      const figure = el('figure', 'post-photo');
      figure.append(photoFor(post, image, 960, 540));
      if (post.kind !== 'activity') figure.append(el('figcaption', '', board.image));
      body.append(figure);
    }

    const actions = el('div', 'detail-actions');
    if (post.kind === 'recruitment') {
      const info = post.recruitment ?? {};
      const closed = recruitmentClosed(post);
      addFacts(body, [
        ['행사 일정', [dateLabel(post.date), info.eventTime].filter(Boolean).join(' ')],
        ['장소', info.place], ['대상', info.audience], ['신청 마감일', dateLabel(info.deadline)],
      ], closed);
      if (!closed && httpsUrl(info.applicationUrl)) {
        const application = el('div', 'post-application');
        appendLink(application, info.applicationUrl, '신청하기', 'button');
        body.append(application);
      }
    } else if (post.kind === 'publication') {
      const info = post.publication ?? {};
      addFacts(body, [
        [info.dateLabel || '발간일', dateLabel(post.date)], ['발행처', info.publisher], ['열람 안내', info.accessText],
      ]);
      appendLink(actions, info.fileUrl, '발간물 열기', 'button', true);
      appendLink(actions, info.previewUrl, info.previewLabel || '미리 읽기', 'text-link', true);
      if (info.previewLabel === '표지 크게 보기') {
        const download = appendLink(actions, info.previewUrl, '표지 이미지 내려받기 ↓', 'text-link', true);
        if (download) download.download = '';
      }
    }
    for (const paragraph of post.paragraphs) body.append(el('p', '', paragraph));
    drawAttachments(body, attachmentsFor(post));
    appendLink(actions, post.sourceUrl, post.sourceLabel || '관련 자료 보기');
    if (actions.children.length) body.append(actions);
  }

  async function prepareUpload(file) {
    if (!imageTypes.includes(file.type)) throw new Error('PNG, JPG 또는 WebP 이미지를 선택해 주세요.');
    if (!file.size) throw new Error('파일이 비어 있습니다. 다른 이미지를 선택해 주세요.');
    if (file.size > uploadLimitMiB * 1024 * 1024) throw new Error(`이미지 원본은 최대 ${uploadLimitMiB}MB까지 올릴 수 있습니다.`);

    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode().catch(() => { throw new Error('이미지를 열 수 없습니다. 파일이 정상적으로 열리는지 확인해 주세요.'); });
      if (file.size <= storedImageLimit) return file;

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) throw new Error('브라우저에서 이미지 크기를 조정할 수 없습니다.');
      // Keep alpha in PNG and WebP. Browsers without WebP encoding fall back to PNG.
      const mimeType = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/webp';
      let scale = Math.min(1, 2048 / Math.max(image.naturalWidth, image.naturalHeight));
      for (let attempt = 0; attempt < 6; attempt++) {
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const encoded = await new Promise((resolve) => canvas.toBlob(resolve, mimeType, .86));
        if (encoded?.size && encoded.size <= storedImageLimit) return encoded;
        scale *= .78;
      }
      throw new Error('게시용 크기로 이미지를 줄이지 못했습니다. 다른 이미지를 선택해 주세요.');
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function readUploadedImage(file) {
    const blob = await prepareUpload(file);
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener('load', () => {
        const source = safeImage(reader.result);
        if (source) resolve(source);
        else reject(new Error('이미지를 게시용 형식으로 저장할 수 없습니다.'));
      });
      reader.addEventListener('error', () => reject(new Error('이미지 파일을 읽지 못했습니다.')));
      reader.readAsDataURL(blob);
    });
  }

  window.jachicoopPrepareImage = readUploadedImage;

  async function readImage(file, address) {
    if (file?.name) return readUploadedImage(file);
    const url = httpsUrl(address);
    if (address && !url) throw new Error('이미지 주소는 https:// 주소를 넣어 주세요.');
    return url;
  }

  function setupEditor(form) {
    const field = form.elements;
    const status = form.querySelector('[data-editor-status]');
    const submit = form.querySelector('button[type="submit"]');
    const deleteButton = form.querySelector('[data-editor-delete]');
    const deleteDialog = form.parentElement.querySelector('[data-delete-dialog]');
    const clearImage = form.querySelector('[data-clear-image]');
    const clearFiles = form.querySelector('[data-clear-attachments]');
    const storedFiles = form.querySelector('[data-editor-attachments]');
    const requested = params.get('board');
    const editId = params.get('edit');
    const catalog = JSON.parse(document.querySelector('#post-catalog').textContent);
    const saved = editId && readPostEntries().find((post) => post.id === editId);
    const original = editId && !saved?.deleted && (saved || catalog.find((post) => post.id === editId));
    const expected = original?._revision ?? null;
    if (editId && !original) {
      form.remove();
      document.querySelector('[data-editor-missing]').hidden = false;
      return;
    }
    if (Object.hasOwn(boards, requested)) field.kind.value = requested;
    field.date.value = todayInKorea();
    if (original) {
      document.querySelector('[data-editor-title]').textContent = '게시글 수정';
      document.title = '게시글 수정 | 길잡이';
      field.kind.value = original.kind;
      field.kind.disabled = true;
      for (const key of ['title', 'topic', 'date', 'summary', 'alt']) field[key].value = original[key] || '';
      field.body.value = original.paragraphs.join('\n\n');
      field.image.value = httpsUrl(original.image);
      form.querySelector('[data-editor-existing-image]').hidden = !original.image;
      if (original.recruitment) {
        for (const key of ['place', 'audience', 'deadline', 'eventTime', 'applicationUrl']) {
          field[key].value = original.recruitment[key] || '';
        }
      }
      if (original.publication) {
        field.publisher.value = original.publication.publisher || field.publisher.defaultValue;
        field.accessText.value = original.publication.accessText || '';
        for (const key of ['fileUrl', 'previewUrl']) field[key].value = httpsUrl(original.publication[key]);
      }
      const back = form.querySelector('[data-editor-back]');
      back.textContent = '게시글로 돌아가기';
    }

    function updateFields() {
      const kind = field.kind.value;
      const board = boards[kind];
      for (const section of form.querySelectorAll('[data-editor-kind]')) {
        const visible = section.dataset.editorKind === kind;
        section.hidden = !visible;
        section.disabled = !visible;
      }
      form.querySelector('[data-editor-date-label]').textContent = board.date;
      form.querySelector('[data-editor-image-label]').textContent = board.image;
      form.querySelector('[data-editor-back]').href = original ? detailHref(original.id) : board.href;
      form.querySelector('[data-editor-existing-image]').hidden = !original?.image;
    }

    function refreshPickers() {
      clearImage.hidden = !field.imageFile.files.length;
      clearFiles.hidden = !field.attachments.files.length;
    }

    function drawStoredFiles() {
      const controls = attachmentsFor(original).map(({ id, name }) => {
        const label = el('label', 'post-image-removal');
        const input = el('input');
        input.type = 'checkbox';
        input.name = 'removeAttachment';
        input.value = id;
        label.append(input, `${name} 삭제`);
        return label;
      });
      storedFiles.hidden = !controls.length;
      storedFiles.replaceChildren(...controls);
    }

    function showStatus(message) {
      status.textContent = message;
      status.hidden = false;
      status.focus();
    }

    field.kind.addEventListener('change', updateFields);
    field.imageFile.addEventListener('change', () => {
      if (field.imageFile.files.length) field.removeImage.checked = false;
      refreshPickers();
    });
    field.attachments.addEventListener('change', refreshPickers);
    clearImage.addEventListener('click', () => {
      field.imageFile.value = '';
      field.imageFile.focus();
      refreshPickers();
    });
    clearFiles.addEventListener('click', () => {
      field.attachments.value = '';
      field.attachments.focus();
      refreshPickers();
    });
    updateFields();
    drawStoredFiles();
    refreshPickers();
    submit.disabled = false;
    if (original) deleteButton.hidden = false;
    deleteButton.addEventListener('click', () => {
      if (!isAdmin() || !original || submit.disabled) return;
      deleteDialog.returnValue = '';
      deleteDialog.showModal();
    });
    deleteDialog.addEventListener('close', async () => {
      if (deleteDialog.returnValue !== 'delete' || !isAdmin() || !original) return;
      deleteButton.disabled = true;
      submit.disabled = true;
      try {
        await server.request('/api/post', {
          method: 'DELETE', body: { id: original.id, expected },
        });
        location.assign(boards[original.kind].href);
      } catch (error) {
        showStatus(error.message);
        deleteButton.disabled = false;
        submit.disabled = false;
      }
    });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!isAdmin() || submit.disabled) return;
      const values = new FormData(form);
      const text = (name) => String(values.get(name) ?? '').trim();
      const checkedLink = (name, label, existing = '') => {
        const raw = text(name);
        const valid = httpsUrl(raw);
        if (raw && !valid) throw new Error(`${label}은 https:// 주소를 넣어 주세요.`);
        return valid || (existing && !httpsUrl(existing) ? existing : '');
      };
      submit.disabled = true;
      try {
        const kind = original?.kind || text('kind');
        const title = text('title');
        const topic = text('topic');
        const paragraphs = text('body').split(/\n+/).map((paragraph) => paragraph.trim()).filter(Boolean);
        if (!Object.hasOwn(boards, kind) || !title || !topic || !paragraphs.length) {
          throw new Error('게시판, 제목, 태그, 본문을 확인해 주세요.');
        }
        const first = paragraphs[0].replace(/\s+/g, ' ');
        const summary = text('summary') || (first.length > 135 ? `${first.slice(0, 134)}…` : first);
        const id = original?.id || newId('local');
        const file = values.get('imageFile');
        const address = text('image');
        const removeImage = values.has('removeImage');
        const image = file?.name || (address && !removeImage)
          ? await readImage(file, address)
          : (removeImage ? '' : safeImage(original?.image));
        const post = {
          ...original,
          id, kind, title, shortTitle: title, date: text('date'), publishedAt: original?.publishedAt || new Date().toISOString(), topic,
          summary, paragraphs, image,
          alt: text('alt') || `${title} ${boards[kind].image}`,
        };
        if (kind === 'recruitment') {
          post.recruitment = {
            ...original?.recruitment,
            place: text('place'), audience: text('audience'), deadline: text('deadline'), eventTime: text('eventTime'),
            applicationUrl: checkedLink('applicationUrl', '신청 링크'),
            closed: original?.recruitment?.deadline === text('deadline') && Boolean(original?.recruitment?.closed),
          };
          if (!post.recruitment.place || !post.recruitment.audience) throw new Error('장소와 대상을 확인해 주세요.');
        } else if (kind === 'publication') {
          post.publication = {
            ...original?.publication,
            publisher: text('publisher'), accessText: text('accessText'),
            fileUrl: checkedLink('fileUrl', '열람 파일 주소', original?.publication?.fileUrl),
            previewUrl: checkedLink('previewUrl', '미리보기 주소', original?.publication?.previewUrl),
          };
          if (!post.publication.publisher) throw new Error('발행처를 확인해 주세요.');
        }

        const removeIds = new Set(values.getAll('removeAttachment'));
        const existingFiles = attachmentsFor(original);
        const added = values.getAll('attachments').filter((file) => file.name).map((file) => {
          if (!attachmentTypes.test(file.name)) throw new Error('PDF, 한글, Office, TXT, ZIP 중에서 첨부파일을 선택해 주세요.');
          if (!file.size || file.size > attachmentLimit) throw new Error('내용이 있는 30MB 이하의 파일을 첨부해 주세요.');
          return { info: { id: newId('file'), name: file.name }, file };
        });
        post.attachments = [...existingFiles.filter(({ id }) => !removeIds.has(id)), ...added.map(({ info }) => info)];
        if (!isAdmin()) return;
        const body = new FormData();
        body.set('payload', JSON.stringify({ post, expected }));
        for (const { info, file } of added) body.set(info.id, file);
        await server.request('/api/post', { method: 'POST', body });
        location.assign(detailHref(id));
      } catch (error) {
        showStatus(error.message);
      } finally {
        submit.disabled = false;
      }
    });
  }

  function refresh() {
    const entries = readPostEntries();
    const deleted = deletedPostIds(entries);
    const posts = entries.filter((post) => !post.deleted);
    if (grids.length) drawGrids(posts, deleted);
    if (entryPage) {
      const id = entryPage.dataset.seedPost || params.get('id');
      const post = posts.find((item) => item.id === id);
      if (deleted.has(id)) drawDeletedEntry(entryPage);
      else if (post) drawEntry(entryPage, post);
      else if (entryChanged && initialEntry) {
        document.title = initialTitle;
        entryPage.replaceChildren(...[...initialEntry.childNodes].map((node) => node.cloneNode(true)));
        entryChanged = false;
      }
    }
    window.dispatchEvent(new Event('preview-posts-updated'));
  }

  const form = document.querySelector('[data-post-editor]');
  let contentReady = false;
  let editorReady = false;
  function setupAuthorizedEditor() {
    if (!form || !contentReady || editorReady || !isAdmin()) return;
    editorReady = true;
    setupEditor(form);
  }
  server?.ready.then(() => {
    contentReady = true;
    setupAuthorizedEditor();
  }).catch(() => {});
  window.addEventListener('jachicoop-auth', setupAuthorizedEditor);
  if (entryPage) {
    entryPage.addEventListener('click', (event) => {
      if (!event.target.closest('[data-post-back]')) return;
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || history.length < 2 || !document.referrer) return;
      const previous = new URL(document.referrer);
      if (previous.pathname.endsWith('/admin-posts.html')) return;
      if (previous.protocol === location.protocol && ['http:', 'https:', 'file:'].includes(previous.protocol)
        && new URL('./', previous).href === new URL('./', location.href).href && previous.href !== location.href) {
        event.preventDefault();
        history.back();
      }
    });
  }
  if (grids.length || entryPage) {
    refresh();
    server?.ready.then(refresh).catch(() => {});
    window.addEventListener('jachicoop-content', refresh);
  }
})();
