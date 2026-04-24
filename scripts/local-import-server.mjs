import { createServer } from 'node:http';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname, join, relative } from 'node:path';

const PROJECT_ROOT = '/home/kaixin/work-ai/reader';
const IMPORTED_BOOKS_JSON = join(PROJECT_ROOT, 'src', 'lib', 'imported-books.json');
const BOOKS_PUBLIC_ROOT = join(PROJECT_ROOT, 'public', 'books');
const RAW_UPLOAD_ROOT = join(PROJECT_ROOT, 'public', 'uploads', 'raw');
const IMPORT_SCRIPT = join(PROJECT_ROOT, 'scripts', 'epub-preprocess', 'import_epub.py');
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const PORT = 4327;

/**
 * @typedef {{bookId: string, title: string, author: string, cover: string, detailUrl: string, readUrl: string}} ImportResult
 */

function isAllowedOrigin(origin) {
  if (!origin) return false;

  try {
    const { protocol, hostname } = new URL(origin);
    return protocol === 'http:' && (hostname === '127.0.0.1' || hostname === 'localhost');
  } catch {
    return false;
  }
}

const DEFAULT_ALLOWED_ORIGIN = 'http://127.0.0.1:4326';

function getAllowedOrigin(requestOrigin) {
  return requestOrigin && isAllowedOrigin(requestOrigin) ? requestOrigin : DEFAULT_ALLOWED_ORIGIN;
}

function sendJson(req, res, status, body) {
  const allowOrigin = getAllowedOrigin(req.headers.origin);

  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(body));
}

async function loadImportedBooks() {
  try {
    const content = await readFile(IMPORTED_BOOKS_JSON, 'utf-8');
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveImportedBooks(books) {
  await writeFile(IMPORTED_BOOKS_JSON, `${JSON.stringify(books, null, 2)}\n`, 'utf-8');
}

function toProjectRelativePath(filePath) {
  return relative(PROJECT_ROOT, filePath).replaceAll('\\', '/');
}

function toAbsoluteProjectPath(projectRelativePath) {
  if (!projectRelativePath) return null;
  const normalized = projectRelativePath.replace(/^\/+/, '');
  const absolute = join(PROJECT_ROOT, normalized);
  const rel = relative(PROJECT_ROOT, absolute);
  if (rel.startsWith('..') || rel === '') return null;
  return absolute;
}

function toBookListItem(book) {
  return {
    id: book.id,
    title: book.title,
    author: book.author
  };
}

async function deleteImportedBook(bookId) {

  const books = await loadImportedBooks();
  const book = books.find((item) => item.id === bookId);
  if (!book) {
    return { status: 404, body: { ok: false, message: '未找到对应书籍。' } };
  }

  const remainingBooks = books.filter((item) => item.id !== bookId);
  await saveImportedBooks(remainingBooks);
  await rm(join(BOOKS_PUBLIC_ROOT, bookId), { recursive: true, force: true });

  const removedRawFiles = [];
  const rawAbsolutePath = toAbsoluteProjectPath(book.rawTarget);
  const rawTargetStillUsed = book.rawTarget && remainingBooks.some((item) => item.rawTarget === book.rawTarget);
  if (rawAbsolutePath && !rawTargetStillUsed) {
    await rm(rawAbsolutePath, { force: true });
    await removeEmptyParentDir(rawAbsolutePath);
    removedRawFiles.push(book.rawTarget);
  }

  const message = removedRawFiles.length > 0
    ? '已删除该书及相关本地文件。'
    : '已删除该书；这本书没有可清理的原始 EPUB 文件。';

  return {
    status: 200,
    body: {
      ok: true,
      bookId,
      removedRawFiles,
      message
    }
  };
}

function runImport(epubPath, rawTarget) {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', [IMPORT_SCRIPT, epubPath, rawTarget], {
      cwd: PROJECT_ROOT,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || 'EPUB 导入失败。'));
        return;
      }

      try {
        resolve(JSON.parse(stdout.trim()));
      } catch {
        reject(new Error('导入结果解析失败。'));
      }
    });
  });
}

function parseMultipart(buffer, contentType) {
  const boundaryMatch = contentType.match(/boundary=(.+)$/);
  if (!boundaryMatch) throw new Error('缺少 multipart boundary。');
  const boundary = `--${boundaryMatch[1]}`;
  const body = buffer.toString('binary');
  const parts = body.split(boundary).slice(1, -1);

  for (const part of parts) {
    const [rawHeaders, rawContent] = part.split('\r\n\r\n');
    if (!rawHeaders || !rawContent) continue;
    const disposition = rawHeaders.match(/name="([^"]+)"(?:; filename="([^"]+)")?/);
    if (!disposition || disposition[1] !== 'file' || !disposition[2]) continue;
    const filename = disposition[2];
    const content = rawContent.slice(0, -2);
    return { filename, buffer: Buffer.from(content, 'binary') };
  }

  throw new Error('未找到上传文件。');
}

function buildRawFilename(filename) {
  const match = filename.match(/^(.*?)(\.[^.]+)?$/);
  const rawExt = match?.[2]?.toLowerCase() ?? '.epub';
  return `${Date.now()}-${randomUUID()}${rawExt}`;
}

async function removeEmptyParentDir(filePath) {
  if (!filePath) return;
  await rm(dirname(filePath)).catch(() => {});
}

createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    sendJson(req, res, 204, {});
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    sendJson(req, res, 200, { ok: true, mode: 'local-import', message: 'ready' });
    return;
  }

  if (req.method === 'GET' && req.url === '/books') {
    const books = await loadImportedBooks();
    sendJson(req, res, 200, { ok: true, books: books.map(toBookListItem) });
    return;
  }

  if (req.method === 'GET' && req.url === '/books/full') {
    const books = await loadImportedBooks();
    sendJson(req, res, 200, { ok: true, books });
    return;
  }

  if (req.method === 'DELETE' && req.url?.startsWith('/books/')) {
    const bookId = decodeURIComponent(req.url.slice('/books/'.length));
    const result = await deleteImportedBook(bookId);
    sendJson(req, res, result.status, result.body);
    return;
  }

  if (req.method !== 'POST' || req.url !== '/import') {
    sendJson(req, res, 404, { ok: false, message: 'Not found' });
    return;
  }

  let rawPath = null;

  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);
    if (buffer.length > MAX_FILE_SIZE) {
      sendJson(req, res, 413, { ok: false, message: '文件过大，当前限制为 50MB。' });
      return;
    }

    const contentType = req.headers['content-type'] || '';
    const file = parseMultipart(buffer, contentType);
    if (!file.filename.toLowerCase().endsWith('.epub')) {
      sendJson(req, res, 400, { ok: false, message: '当前接口只接受 .epub 文件。' });
      return;
    }

    const datePrefix = new Date().toISOString().slice(0, 10);
    const rawName = buildRawFilename(file.filename);
    const rawDir = join(RAW_UPLOAD_ROOT, datePrefix);
    rawPath = join(rawDir, rawName);
    const rawTarget = toProjectRelativePath(rawPath);
    await mkdir(rawDir, { recursive: true });
    await writeFile(rawPath, file.buffer);

    const imported = /** @type {ImportResult} */ (await runImport(rawPath, rawTarget));
    sendJson(req, res, 200, {
      ok: true,
      mode: 'local-import',
      filename: file.filename,
      size: file.buffer.length,
      validatedAt: new Date().toISOString(),
      rawTarget,
      ...imported,
      message: 'EPUB 已导入本地书库，刷新首页即可看到新书。'
    });
  } catch (error) {
    if (rawPath) {
      await rm(rawPath, { force: true }).catch(() => {});
    }
    sendJson(req, res, 500, {
      ok: false,
      message: error instanceof Error ? error.message : '导入失败，请检查 EPUB 内容或本地环境。'
    });
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Local import server ready on http://127.0.0.1:${PORT}`);
});
