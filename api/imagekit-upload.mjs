import { createHmac, randomUUID } from 'node:crypto';

const project = 'jachicoop26';
const extensions = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);

function subject(token) {
  if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token) || token.length > 8192) return '';
  try {
    const { sub, aud, iss } = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    if (aud === project && iss === `https://securetoken.google.com/${project}` && typeof sub === 'string'
      && /^[A-Za-z0-9_-]{1,128}$/.test(sub)) return sub;
  } catch {
    // Invalid tokens are handled the same way as absent credentials.
  }
  return '';
}

function json(status, data) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request) {
  const token = /^Bearer (\S+)$/.exec(request.headers.get('authorization') ?? '')?.[1] ?? '';
  const uid = subject(token);
  if (!uid) return json(401, { message: '관리자로 다시 로그인해 주세요.' });

  const { mime } = await request.json().catch(() => null) ?? {};
  const extension = extensions.get(mime);
  if (!extension) return json(400, { message: 'JPG, PNG, WebP 사진을 선택해 주세요.' });

  try {
    // The ID token is validated by Firestore. Its rules allow users to read only their own admin record.
    const endpoint = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/cmsAdmins/${uid}`;
    const admin = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (admin.status === 401) return json(401, { message: '관리자로 다시 로그인해 주세요.' });
    if (admin.status === 403 || admin.status === 404) {
      return json(403, { message: '사진을 올릴 수 있는 관리자 권한이 없습니다.' });
    }
    if (!admin.ok) return json(503, { message: '관리자 권한을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.' });
    if ((await admin.json()).fields?.enabled?.booleanValue !== true) {
      return json(403, { message: '사진을 올릴 수 있는 관리자 권한이 없습니다.' });
    }

    const privateKey = process.env.IMAGEKIT_PRIVATE_KEY?.trim();
    const publicKey = process.env.IMAGEKIT_PUBLIC_KEY?.trim();
    if (!privateKey || !publicKey) {
      return json(503, { message: 'Vercel에 ImageKit의 Public Key와 Private Key를 등록해 주세요.' });
    }
    const fields = {
      fileName: `${randomUUID()}.${extension}`,
      folder: '/jachicoop',
      checks: `"file.size" < 5000001 AND "file.mime" : "${mime}"`,
    };
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const iat = Math.floor(Date.now() / 1000);
    const unsigned = `${encode({ alg: 'HS256', typ: 'JWT', kid: publicKey })}.${encode({ ...fields, iat, exp: iat + 300 })}`;
    const signature = createHmac('sha256', privateKey).update(unsigned).digest('base64url');
    return json(200, { fields, token: `${unsigned}.${signature}` });
  } catch {
    return json(503, { message: '사진 업로드를 승인할 수 없습니다. 잠시 후 다시 시도해 주세요.' });
  }
}
