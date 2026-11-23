const SDK_ROOT = 'https://www.gstatic.com/firebasejs/13.4.0/';
const publishLimit = 900 * 1024;

function cmsError(message, status) {
  return Object.assign(new Error(message), { status });
}

function explainError(error) {
  if (error.status) return error;
  switch (error.code) {
    case 'auth/invalid-credential':
    case 'auth/invalid-email':
    case 'auth/user-not-found':
    case 'auth/wrong-password':
      return cmsError('이메일 또는 비밀번호를 확인해 주세요.', 401);
    case 'auth/operation-not-allowed':
      return cmsError('Firebase에서 이메일/비밀번호 로그인을 켜 주세요.', 503);
    case 'permission-denied':
      return cmsError('권한을 확인할 수 없습니다. Firebase의 Firestore 규칙과 관리자 설정을 확인해 주세요.', 403);
    case 'auth/too-many-requests':
    case 'resource-exhausted':
      return cmsError('요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.', 429);
    default:
      return cmsError('Firebase에 연결할 수 없습니다. 프로젝트 설정을 확인하거나 잠시 후 다시 시도해 주세요.', 503);
  }
}

async function loadSdk() {
  const [app, auth, store] = await Promise.all([
    import(SDK_ROOT + 'firebase-app.js'),
    import(SDK_ROOT + 'firebase-auth.js'),
    import(SDK_ROOT + 'firebase-firestore.js'),
  ]);
  return { ...app, ...auth, ...store };
}

export async function connectFirestore(config, sdk) {
  const client = sdk ?? await loadSdk();
  const app = client.initializeApp(config);
  const database = client.getFirestore(app);
  const auth = client.initializeAuth(app, { persistence: client.browserSessionPersistence });
  const reference = (collection, id) => client.doc(database, collection, id);
  const hero = reference('cmsSettings', 'hero');
  await auth.authStateReady();

  async function hasAdmin(user = auth.currentUser) {
    if (!user) return false;
    return (await client.getDocFromServer(reference('cmsAdmins', user.uid))).data()?.enabled === true;
  }

  async function readContent() {
    const [posts, slides] = await Promise.all([
      client.getDocsFromServer(client.collection(database, 'cmsPosts')),
      client.getDocFromServer(hero),
    ]);
    return {
      posts: posts.docs.map((document) => {
        const { data, revision } = document.data();
        return { ...data, _revision: revision };
      }),
      slides: slides.data()?.data.slides ?? null,
      slidesRevision: slides.data()?.revision ?? null,
    };
  }

  async function save(target, data, expected) {
    if (!auth.currentUser) throw cmsError('관리자 로그인이 필요합니다.', 401);
    if (new TextEncoder().encode(JSON.stringify(data)).byteLength > publishLimit) {
      throw cmsError('저장할 내용이 너무 큽니다. 사진을 HTTPS 링크로 연결한 뒤 다시 저장해 주세요.', 400);
    }
    const revision = crypto.randomUUID();
    return client.runTransaction(database, async (transaction) => {
      const current = (await transaction.get(target)).data()?.revision ?? null;
      if (current !== expected) throw cmsError('다른 곳에서 내용이 바뀌었습니다. 화면을 새로고침한 뒤 다시 편집해 주세요.', 409);
      transaction.set(target, { revision, data });
      return { revision };
    });
  }

  async function request(path, { method = 'GET', body } = {}) {
    try {
      if (path === '/api/session' && method === 'GET') return { isAdmin: await hasAdmin() };
      if (path === '/api/session' && method === 'POST') {
        const { user } = await client.signInWithEmailAndPassword(auth, body.email, body.password);
        try {
          if (!await hasAdmin(user)) throw cmsError('이 계정에는 길잡이 관리자 권한이 없습니다.', 403);
        } catch (error) {
          await client.signOut(auth);
          throw error;
        }
        return { isAdmin: true };
      }
      if (path === '/api/session' && method === 'DELETE') {
        await client.signOut(auth);
        return { isAdmin: false };
      }
      if (path === '/api/content' && method === 'GET') return await readContent();
      if (path === '/api/post' && method === 'POST') {
        const { _revision, ...post } = body.post;
        return await save(reference('cmsPosts', post.id), post, body.expected);
      }
      if (path === '/api/post' && method === 'DELETE') {
        return await save(reference('cmsPosts', body.id), { id: body.id, deleted: true }, body.expected);
      }
      if (path === '/api/slides' && method === 'PUT') {
        if (body.slides.length > 50) throw cmsError('메인 슬라이드는 최대 50개까지 저장할 수 있습니다.', 400);
        return await save(hero, { slides: body.slides }, body.expected);
      }
      throw cmsError('지원하지 않는 요청입니다.', 404);
    } catch (error) {
      throw explainError(error);
    }
  }

  return { request };
}
