'use strict';

(() => {
  const sizeLimit = 5_000_000;
  const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

  async function preparePhoto(file, previewUrl) {
    if (!imageTypes.has(file.type) || !file.size) throw new Error('JPG, PNG, WebP 사진을 선택해 주세요.');
    const source = new Image();
    source.src = previewUrl;
    try {
      await source.decode();
    } catch {
      throw new Error('이 사진을 열 수 없습니다. 다른 이미지 파일을 선택해 주세요.');
    }
    if (file.size <= sizeLimit) return file;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const type = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/webp';
    let scale = Math.min(1, 2560 / Math.max(source.naturalWidth, source.naturalHeight));
    try {
      for (const quality of [0.88, 0.8, 0.73, 0.66, 0.6]) {
        canvas.width = Math.max(1, Math.round(source.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(source.naturalHeight * scale));
        ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, quality));
        if (blob?.size > 0 && blob.size <= sizeLimit && imageTypes.has(blob.type)) return blob;
        scale *= 0.77;
      }
    } finally {
      canvas.width = canvas.height = 0;
    }
    throw new Error('사진을 5MB 이하로 줄이지 못했습니다. 더 작은 사진을 선택해 주세요.');
  }

  async function uploadImage(file, server) {
    const { fields, token } = await server.request('/api/imagekit-upload', { method: 'POST', body: { mime: file.type } });
    const data = new FormData();
    data.set('file', file, fields.fileName);
    for (const [name, value] of Object.entries(fields)) data.set(name, value);
    data.set('token', token);
    const response = await fetch('https://upload.imagekit.io/api/v2/files/upload', {
      method: 'POST', body: data, signal: AbortSignal.timeout(60000),
    }).catch(() => { throw new Error('사진 전송에 실패했습니다. 연결을 확인하고 다시 저장해 주세요.'); });
    const info = await response.json().catch(() => null);
    if (!response.ok || !/^https:\/\/ik\.imagekit\.io\//.test(info?.url ?? '')) {
      if (response.status === 429) throw new Error('ImageKit 이용 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.');
      throw new Error('ImageKit에 사진을 저장하지 못했습니다. 키 설정과 저장공간을 확인해 주세요.');
    }
    return info.url;
  }

  function setup(root, server, onChange = () => {}) {
    const input = root.querySelector('input[type="file"]');
    const preview = root.querySelector('img');
    const status = root.querySelector('[data-photo-status]');
    const clear = root.querySelector('[data-clear-photo]');
    let selection = null;

    function release(item) {
      if (item) URL.revokeObjectURL(item.previewUrl);
    }

    function reset() {
      release(selection);
      selection = null;
      input.value = '';
      preview.hidden = true;
      preview.removeAttribute('src');
      clear.hidden = true;
      status.textContent = '';
      onChange();
    }

    input.addEventListener('change', () => {
      release(selection);
      selection = null;
      preview.hidden = true;
      preview.removeAttribute('src');
      const file = input.files[0];
      if (!file) return reset();
      const item = { previewUrl: URL.createObjectURL(file) };
      selection = item;
      clear.hidden = false;
      status.textContent = '사진을 확인하는 중입니다.';
      item.ready = preparePhoto(file, item.previewUrl).then((prepared) => {
        if (selection !== item) return null;
        if (prepared !== file) {
          release(item);
          item.previewUrl = URL.createObjectURL(prepared);
        }
        preview.src = item.previewUrl;
        preview.hidden = false;
        status.textContent = prepared === file ? '저장할 때 사진을 업로드합니다.' : '사진을 5MB 이하로 줄였습니다. 저장할 때 업로드합니다.';
        return prepared;
      }).catch((error) => {
        if (selection === item) status.textContent = error.message;
        item.error = error;
        return null;
      });
      onChange();
    });
    clear.addEventListener('click', reset);

    async function save() {
      const item = selection;
      if (!item) return '';
      const file = await item.ready;
      if (!file || item !== selection) throw item.error || new Error('사진을 다시 선택해 주세요.');
      if (item.url) return item.url;
      status.textContent = 'ImageKit에 사진을 업로드하는 중입니다.';
      try {
        item.url = await uploadImage(file, server);
        status.textContent = '사진 업로드가 완료됐습니다.';
        return item.url;
      } catch (error) {
        status.textContent = error.message;
        throw error;
      }
    }

    return { reset, save, get selected() { return selection !== null; } };
  }

  window.jachicoopImages = { setup };
})();
