'use strict';

(() => {
  const storagePrefix = 'jachicoop-preview-post:';
  const postIdFormat = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
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

  const bodyTags = new Map([['P', 'p'], ['DIV', 'div'], ['BR', 'br'], ['B', 'strong'], ['STRONG', 'strong'], ['U', 'u']]);
  const bodyFonts = new Set(['sans-serif', 'serif', 'monospace']);

  function formattedBody(markup) {
    const source = el('template');
    source.innerHTML = markup;
    const result = document.createDocumentFragment();

    function copy(parent, nodes) {
      for (const node of nodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          parent.append(node.textContent);
          continue;
        }
        if (node.nodeType !== Node.ELEMENT_NODE || node.namespaceURI !== 'http://www.w3.org/1999/xhtml') continue;
        const tag = bodyTags.get(node.tagName);
        const font = [node.dataset.font, node.getAttribute('face'), node.style.fontFamily]
          .find((value) => bodyFonts.has(value));
        if (!tag && !font) {
          if (!['SCRIPT', 'STYLE', 'TEMPLATE', 'IFRAME', 'OBJECT'].includes(node.tagName)) copy(parent, node.childNodes);
          continue;
        }
        const safe = el(tag || 'span');
        if (font) safe.dataset.font = font;
        copy(safe, node.childNodes);
        parent.append(safe);
      }
    }

    copy(result, source.content.childNodes);
    return result;
  }

  function setupBodyEditor(form, original) {
    const editor = form.querySelector('#editor-body');
    const buttons = [...form.querySelectorAll('[data-format]')];
    const font = form.querySelector('[data-editor-font]');
    let range;
    const saved = typeof original?.bodyHtml === 'string' && formattedBody(original.bodyHtml);
    if (saved?.textContent?.trim()) editor.append(saved);
    else for (const paragraph of original?.paragraphs ?? []) editor.append(el('p', '', paragraph));

    function rememberSelection() {
      const selection = window.getSelection();
      if (!selection.rangeCount) return;
      const selected = selection.getRangeAt(0);
      if (!editor.contains(selected.commonAncestorContainer)) return;
      range = selected.cloneRange();
      for (const button of buttons) button.setAttribute('aria-pressed', String(document.queryCommandState(button.dataset.format)));
    }

    function format(command, value) {
      editor.focus();
      if (range && editor.contains(range.commonAncestorContainer)) {
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      }
      document.execCommand('styleWithCSS', false, false);
      document.execCommand(command, false, value);
      rememberSelection();
    }

    document.addEventListener('selectionchange', rememberSelection);
    for (const button of buttons) {
      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('click', () => format(button.dataset.format));
    }
    font.addEventListener('change', () => {
      if (bodyFonts.has(font.value)) format('fontName', font.value);
      font.selectedIndex = 0;
    });
    editor.addEventListener('paste', (event) => {
      event.preventDefault();
      document.execCommand('insertText', false, event.clipboardData?.getData('text/plain') ?? '');
    });
    editor.addEventListener('drop', (event) => event.preventDefault());

    return () => {
      const text = editor.innerText.trim();
      const paragraphs = text.split(/\n+/).map((paragraph) => paragraph.trim()).filter(Boolean);
      const clean = el('div');
      clean.append(formattedBody(editor.innerHTML));
      if (text.length > 6000 || clean.innerHTML.length > 100000) throw new Error('본문은 최대 6,000자까지 쓸 수 있습니다.');
      return { paragraphs, bodyHtml: clean.innerHTML };
    };
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
    if (!Array.isArray(post?.attachments)) return [];
    return post.attachments
      .filter((item) => typeof item?.name === 'string' && httpsUrl(item.url))
      .map(({ name, url }) => ({ name, url: httpsUrl(url) }));
  }

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
    for (const { url, name } of attachments) {
      const item = el('li');
      appendLink(item, url, `${name} 열기`, 'button button-outline button-small');
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
    const rich = typeof post.bodyHtml === 'string' && formattedBody(post.bodyHtml);
    if (rich?.textContent?.trim()) {
      const container = el('div', 'rich-body');
      container.append(rich);
      body.append(container);
    } else {
      for (const paragraph of post.paragraphs) body.append(el('p', '', paragraph));
    }
    drawAttachments(body, attachmentsFor(post));
    appendLink(actions, post.sourceUrl, post.sourceLabel || '관련 자료 보기');
    if (actions.children.length) body.append(actions);
  }

  function setupEditor(form) {
    const field = form.elements;
    const status = form.querySelector('[data-editor-status]');
    const submit = form.querySelector('button[type="submit"]');
    const deleteButton = form.querySelector('[data-editor-delete]');
    const deleteDialog = form.parentElement.querySelector('[data-delete-dialog]');
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
    const readBody = setupBodyEditor(form, original);
    const existingImage = form.querySelector('[data-editor-existing-image]');
    const imageAttachment = window.jachicoopImages.setup(form.querySelector('[data-image-attachment]'), server, () => {
      if (imageAttachment.selected) field.removeImage.checked = false;
      existingImage.hidden = imageAttachment.selected || !original?.image;
    });
    if (Object.hasOwn(boards, requested)) field.kind.value = requested;
    field.date.value = todayInKorea();
    if (original) {
      document.querySelector('[data-editor-title]').textContent = '게시글 수정';
      document.title = '게시글 수정 | 길잡이';
      field.kind.value = original.kind;
      field.kind.disabled = true;
      for (const key of ['title', 'topic', 'date', 'summary', 'alt']) field[key].value = original[key] || '';
      field.attachmentLinks.value = attachmentsFor(original).map(({ url }) => url).join('\n');
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
    }

    function showStatus(message) {
      status.textContent = message;
      status.hidden = false;
      status.focus();
    }

    field.kind.addEventListener('change', updateFields);
    existingImage.hidden = !original?.image;
    updateFields();
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
      form.inert = true;
      status.hidden = true;
      try {
        const kind = original?.kind || text('kind');
        const title = text('title');
        const topic = text('topic');
        const { paragraphs, bodyHtml } = readBody();
        if (!Object.hasOwn(boards, kind) || !title || !topic || !paragraphs.length) {
          throw new Error('게시판, 제목, 태그, 본문을 확인해 주세요.');
        }
        const first = paragraphs[0].replace(/\s+/g, ' ');
        const summary = text('summary') || (first.length > 135 ? `${first.slice(0, 134)}…` : first);
        const id = original?.id || newId('local');
        const removeImage = values.has('removeImage');
        const post = {
          ...original,
          id, kind, title, shortTitle: title, date: text('date'), publishedAt: original?.publishedAt || new Date().toISOString(), topic,
          summary, paragraphs, bodyHtml,
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

        const existingNames = new Map(attachmentsFor(original).map(({ url, name }) => [url, name]));
        const links = text('attachmentLinks').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        const urls = links.map((link) => {
          const url = httpsUrl(link);
          if (!url) throw new Error('첨부파일 주소는 한 줄에 하나씩 HTTPS 주소로 넣어 주세요.');
          return url;
        });
        post.attachments = [...new Set(urls)].map((url, index) => ({ url, name: existingNames.get(url) ?? `첨부파일 ${index + 1}` }));
        if (!isAdmin()) return;
        post.image = await imageAttachment.save() || (removeImage ? '' : safeImage(original?.image));
        if (!isAdmin()) return;
        await server.request('/api/post', { method: 'POST', body: { post, expected } });
        location.assign(detailHref(id));
      } catch (error) {
        form.inert = false;
        showStatus(error.message);
      } finally {
        form.inert = false;
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
