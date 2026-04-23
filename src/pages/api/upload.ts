import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const GITHUB_API_BASE = 'https://api.github.com';
const GITHUB_UPLOADS_BASE = 'https://uploads.github.com';
const WORKFLOW_FILENAME = 'process-upload.yml';

type UploadJobStatus = 'pending' | 'processing' | 'published' | 'failed';

type GitHubRelease = {
  id: number;
  upload_url: string;
  html_url: string;
  tag_name: string;
};

type EnvWithBindings = typeof env & {
  READER_DB?: D1Database;
  GITHUB_TOKEN?: string;
  GITHUB_REPO_OWNER?: string;
  GITHUB_REPO_NAME?: string;
  GITHUB_RELEASE_TAG?: string;
  GITHUB_RELEASE_NAME?: string;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function sanitizeFilename(filename: string) {
  const match = filename.match(/^(.*?)(\.[^.]+)?$/);
  const rawBase = match?.[1] ?? 'book';
  const rawExt = match?.[2]?.toLowerCase() ?? '';
  const safeBase = rawBase.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  return `${safeBase || 'book'}${rawExt}`;
}

function requireConfig(config: Partial<Record<string, string | D1Database | undefined>>) {
  for (const [key, value] of Object.entries(config)) {
    if (!value) {
      throw new Error(`${key} 未配置`);
    }
  }
}

function githubHeaders(token: string, extraHeaders?: Record<string, string>) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'reader-upload-worker',
    'X-GitHub-Api-Version': '2022-11-28',
    ...extraHeaders
  };
}

async function githubRequest<T>(url: string, init: RequestInit, token: string) {
  const response = await fetch(url, {
    ...init,
    headers: githubHeaders(token, init.headers as Record<string, string> | undefined)
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`GitHub API 请求失败（${response.status}）：${message || 'unknown error'}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

async function ensureRelease(token: string, owner: string, repo: string, tag: string, name: string) {
  try {
    return await githubRequest<GitHubRelease>(`${GITHUB_API_BASE}/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`, { method: 'GET' }, token);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('404')) {
      throw error;
    }
  }

  return githubRequest<GitHubRelease>(`${GITHUB_API_BASE}/repos/${owner}/${repo}/releases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tag_name: tag,
      name,
      draft: false,
      prerelease: false,
      generate_release_notes: false
    })
  }, token);
}

async function uploadReleaseAsset(token: string, owner: string, repo: string, releaseId: number, assetName: string, file: File) {
  const uploadUrl = `${GITHUB_UPLOADS_BASE}/repos/${owner}/${repo}/releases/${releaseId}/assets?name=${encodeURIComponent(assetName)}`;
  const response = await fetch(uploadUrl, {
    method: 'POST',
    headers: githubHeaders(token, {
      'Content-Type': file.type || 'application/epub+zip',
      'Content-Length': String(file.size)
    }),
    body: await file.arrayBuffer()
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`GitHub asset 上传失败（${response.status}）：${message || 'unknown error'}`);
  }

  const data = (await response.json()) as { browser_download_url: string; name: string; id: number };
  return data;
}

async function triggerWorkflow(token: string, owner: string, repo: string, ref: string, uploadId: string) {
  await githubRequest(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/actions/workflows/${encodeURIComponent(WORKFLOW_FILENAME)}/dispatches`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ref,
        inputs: {
          upload_id: uploadId
        }
      })
    },
    token
  );
}

async function createUploadJob(db: D1Database, values: {
  id: string;
  filename: string;
  releaseTag: string;
  assetName: string;
  assetUrl: string;
  rawTarget: string;
  uploadedAt: string;
  size: number;
  status: UploadJobStatus;
}) {
  await db.prepare(`
    INSERT INTO upload_jobs (
      id,
      filename,
      release_tag,
      asset_name,
      asset_url,
      raw_target,
      size,
      status,
      uploaded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    values.id,
    values.filename,
    values.releaseTag,
    values.assetName,
    values.assetUrl,
    values.rawTarget,
    values.size,
    values.status,
    values.uploadedAt
  ).run();
}

export const POST: APIRoute = async ({ request }) => {
  const bindings = env as EnvWithBindings;

  try {
    requireConfig({
      READER_DB: bindings.READER_DB,
      GITHUB_TOKEN: bindings.GITHUB_TOKEN,
      GITHUB_REPO_OWNER: bindings.GITHUB_REPO_OWNER,
      GITHUB_REPO_NAME: bindings.GITHUB_REPO_NAME,
      GITHUB_RELEASE_TAG: bindings.GITHUB_RELEASE_TAG
    });
  } catch (error) {
    return jsonResponse({
      ok: false,
      message: error instanceof Error ? `上传能力未配置完成：${error.message}。` : '上传能力未配置完成。'
    }, 500);
  }

  const formData = await request.formData();
  const file = formData.get('file');

  if (!(file instanceof File)) {
    return jsonResponse({ ok: false, message: '请上传一个 EPUB 文件。' }, 400);
  }

  if (!file.name.toLowerCase().endsWith('.epub')) {
    return jsonResponse({ ok: false, message: '当前接口只接受 .epub 文件。' }, 400);
  }

  if (file.size > MAX_FILE_SIZE) {
    return jsonResponse({ ok: false, message: '文件过大，当前限制为 50MB。' }, 413);
  }

  const uploadedAt = new Date().toISOString();
  const datePrefix = uploadedAt.slice(0, 10);
  const safeName = sanitizeFilename(file.name || 'book.epub');
  const uploadId = crypto.randomUUID();
  const assetName = `${uploadId}-${safeName}`;
  const rawTarget = `public/uploads/raw/${datePrefix}/${safeName}`;
  const owner = bindings.GITHUB_REPO_OWNER!;
  const repo = bindings.GITHUB_REPO_NAME!;
  const token = bindings.GITHUB_TOKEN!;

  try {
    const release = await ensureRelease(
      token,
      owner,
      repo,
      bindings.GITHUB_RELEASE_TAG!,
      bindings.GITHUB_RELEASE_NAME || 'Reader uploads'
    );

    const asset = await uploadReleaseAsset(token, owner, repo, release.id, assetName, file);

    await createUploadJob(bindings.READER_DB!, {
      id: uploadId,
      filename: file.name,
      releaseTag: release.tag_name,
      assetName: asset.name,
      assetUrl: asset.browser_download_url,
      rawTarget,
      uploadedAt,
      size: file.size,
      status: 'pending'
    });

    let workflowTriggered = true;
    let workflowMessage = 'GitHub Actions 已自动触发，处理完成后新书会自动上线。';

    try {
      await triggerWorkflow(token, owner, repo, 'main', uploadId);
    } catch (workflowError) {
      workflowTriggered = false;
      workflowMessage = workflowError instanceof Error
        ? `自动处理触发失败：${workflowError.message}。请在 GitHub Actions 中手动执行 process-upload.yml。`
        : '自动处理触发失败，请在 GitHub Actions 中手动执行 process-upload.yml。';
    }

    return jsonResponse({
      ok: true,
      mode: 'pages-static-import',
      filename: file.name,
      size: file.size,
      validatedAt: uploadedAt,
      rawTarget,
      queued: true,
      uploadId,
      assetName: asset.name,
      assetUrl: asset.browser_download_url,
      releaseTag: release.tag_name,
      workflowTriggered,
      message: `EPUB 已上传到 GitHub，并已进入待发布队列。${workflowMessage}`
    });
  } catch (error) {
    return jsonResponse({
      ok: false,
      message: error instanceof Error ? error.message : '上传失败，请稍后重试。'
    }, 500);
  }
};
