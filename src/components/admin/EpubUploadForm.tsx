import { useEffect, useMemo, useRef, useState } from 'react';
import { invalidateBooksCache } from '../../lib/books';
import type { RuntimeMode } from '../../lib/runtime-mode';

type UploadResponse = {
  ok: boolean;
  mode?: string;
  filename?: string;
  size?: number;
  validatedAt?: string;
  rawTarget?: string;
  message?: string;
  bookId?: string;
  title?: string;
  author?: string;
  cover?: string;
  detailUrl?: string;
  readUrl?: string;
};

type ImportedBook = {
  id: string;
  title: string;
  author: string;
};

type BooksResponse = {
  ok: boolean;
  books?: ImportedBook[];
  message?: string;
};

type DeleteResponse = {
  ok: boolean;
  message?: string;
};

type UploadRequestError = Error & {
  code?: 'network' | 'response' | 'parse';
};

const LOCAL_IMPORT_BASE_URL = 'http://127.0.0.1:4327';
const LOCAL_IMPORT_URL = `${LOCAL_IMPORT_BASE_URL}/import`;
const LOCAL_BOOKS_URL = `${LOCAL_IMPORT_BASE_URL}/books`;

type EpubUploadFormProps = {
  mode: RuntimeMode;
};

export default function EpubUploadForm({ mode }: EpubUploadFormProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<UploadResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [books, setBooks] = useState<ImportedBook[]>([]);
  const [booksLoading, setBooksLoading] = useState(mode === 'local-import');
  const [deletingBookId, setDeletingBookId] = useState<string | null>(null);
  const [deleteMessage, setDeleteMessage] = useState<string | null>(null);

  const localImportMode = mode === 'local-import';
  const canUpload = useMemo(() => !!file && !uploading, [file, uploading]);

  const refreshBooks = async () => {
    const response = await fetch(LOCAL_BOOKS_URL);
    const data = (await response.json()) as BooksResponse;
    if (!response.ok || !data.ok) {
      throw new Error(data.message || '加载已上传书籍失败。');
    }
    setBooks(Array.isArray(data.books) ? data.books : []);
  };

  useEffect(() => {
    let cancelled = false;

    if (!localImportMode) {
      setBooks([]);
      setBooksLoading(false);
      return () => {
        cancelled = true;
      };
    }

    const loadBooks = async () => {
      try {
        await refreshBooks();
      } catch {
        if (!cancelled) {
          setBooks([]);
        }
      } finally {
        if (!cancelled) {
          setBooksLoading(false);
        }
      }
    };

    setBooksLoading(true);
    loadBooks();
    return () => {
      cancelled = true;
    };
  }, [localImportMode]);

  const deleteBook = async (bookId: string) => {
    if (!localImportMode) {
      return;
    }

    setDeletingBookId(bookId);
    setDeleteMessage(null);
    setError(null);

    try {
      const response = await fetch(`${LOCAL_BOOKS_URL}/${encodeURIComponent(bookId)}`, {
        method: 'DELETE'
      });
      const data = (await response.json()) as DeleteResponse;
      if (!response.ok || !data.ok) {
        throw new Error(data.message || '删除失败，请稍后重试。');
      }
      invalidateBooksCache();
      await refreshBooks();
      setDeleteMessage(data.message || '已删除。');
      if (result?.bookId === bookId) {
        setResult(null);
      }
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '删除失败，请稍后重试。');
    } finally {
      setDeletingBookId(null);
    }
  };

  const onFileChange = (nextFile?: File | null) => {
    setResult(null);
    setError(null);
    setDeleteMessage(null);
    setProgress(0);

    if (!nextFile) {
      setFile(null);
      if (inputRef.current) {
        inputRef.current.value = '';
      }
      return;
    }

    const isEpub = nextFile.name.toLowerCase().endsWith('.epub') || nextFile.type === 'application/epub+zip';
    if (!isEpub) {
      setFile(null);
      setError('当前上传页只允许上传 .epub 文件。');
      return;
    }

    setFile(nextFile);
  };

  const reopenFilePicker = () => {
    setResult(null);
    setError(null);
    setDeleteMessage(null);
    setProgress(0);
    if (inputRef.current) {
      inputRef.current.value = '';
      inputRef.current.click();
      return;
    }
    inputRef.current?.click();
  };

  const uploadWithXhr = (url: string, formData: FormData) => {
    return new Promise<UploadResponse>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url, true);

      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        const percent = Math.round((event.loaded / event.total) * 100);
        setProgress(percent);
      };

      xhr.onload = () => {
        try {
          const data = JSON.parse(xhr.responseText) as UploadResponse;
          if (xhr.status >= 200 && xhr.status < 300 && data.ok) {
            resolve(data);
            return;
          }
          const error = new Error(data.message || '校验失败，请检查文件格式或稍后重试。') as UploadRequestError;
          error.code = 'response';
          reject(error);
        } catch {
          const error = new Error('上传完成，但返回结果无法解析。') as UploadRequestError;
          error.code = 'parse';
          reject(error);
        }
      };

      xhr.onerror = () => {
        const error = new Error('网络请求失败，请检查本地开发环境或上传接口。') as UploadRequestError;
        error.code = 'network';
        reject(error);
      };

      xhr.send(formData);
    });
  };

  const upload = async () => {
    if (!file) return;

    setUploading(true);
    setResult(null);
    setError(null);
    setDeleteMessage(null);
    setProgress(8);

    const formData = new FormData();
    formData.append('file', file);

    if (localImportMode) {
      try {
        const localResult = await uploadWithXhr(LOCAL_IMPORT_URL, formData);
        invalidateBooksCache();
        setProgress(100);
        setResult(localResult);
        try {
          await refreshBooks();
        } catch {
          setError('上传已完成，但已上传书籍列表刷新失败，请手动刷新页面。');
        }
      } catch (localError) {
        const error = localError as UploadRequestError;
        setError(error.message || '上传失败，请稍后重试。');
      } finally {
        setUploading(false);
      }
      return;
    }

    try {
      const fallbackResult = await uploadWithXhr('/api/upload', formData);
      setProgress(100);
      setResult(fallbackResult);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : '上传失败，请稍后重试。');
    } finally {
      setUploading(false);
    }
  };

  const importerStatusText = localImportMode
    ? '当前为本地导入模式，上传后会直接进入首页并可在这里删除。'
    : '当前为 Pages 发布模式，上传后会自动进入处理队列，处理完成后会自动发布上线。';

  return (
    <section className="upload-card">
      <form onSubmit={(event) => event.preventDefault()}>
        <div className="notice" style={{ marginBottom: 16 }}>
          {importerStatusText}
        </div>

        <div className="upload-row">
          <label className="file-label" htmlFor="epub-file">{file ? `已选择：${file.name}` : '选择 EPUB 文件'}</label>
          <input
            id="epub-file"
            ref={inputRef}
            className="hidden-input"
            type="file"
            accept=".epub,application/epub+zip"
            onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
          />
        </div>

        <div className="action-row">
          <button className="primary-btn" type="button" onClick={upload} disabled={!canUpload} style={{ opacity: canUpload ? 1 : 0.45 }}>
            {uploading ? '处理中…' : '开始上传'}
          </button>
          <button className="secondary-btn" type="button" onClick={reopenFilePicker}>
            重新选择文件
          </button>
          <button className="secondary-btn" type="button" onClick={() => onFileChange(null)}>
            清空选择
          </button>
        </div>

        <div className="section" style={{ marginTop: 0 }}>
          <div className="progress-bar"><span style={{ width: `${progress}%` }} /></div>
          <p className="muted" style={{ margin: '8px 0 0' }}>{uploading ? `上传进度 ${progress}%` : `当前进度 ${progress}%`}</p>
        </div>

        {error ? <div className="notice">{error}</div> : null}
        {deleteMessage ? <div className="notice">{deleteMessage}</div> : null}

        {result ? (
          <div className="upload-result">
            <div className="notice">
              {result.mode === 'local-import'
                ? '上传完成，可前往首页、详情页或阅读页查看。'
                : '上传已入队，自动处理完成后，新书会在线上可见。'}
            </div>
            <div className="panel" style={{ display: 'grid', gap: 12 }}>
              <div style={{ display: 'grid', gap: 6 }}>
                <strong>{result.title || file?.name || '未命名书籍'}</strong>
                <span className="muted">{result.author || '作者未知'}</span>
                {result.bookId ? <span className="muted">书籍 ID：{result.bookId}</span> : null}
                {result.message ? <span className="muted">{result.message}</span> : null}
                {result.mode !== 'local-import' ? <span className="muted">上传成功后会自动触发 GitHub Actions 处理流程；若自动触发失败，可在仓库里手动执行 process-upload 工作流补跑。</span> : null}
              </div>
              <div className="action-row">
                {result.mode === 'local-import' && result.readUrl ? <a className="primary-btn" href={result.readUrl}>开始阅读</a> : null}
                {result.mode === 'local-import' && result.detailUrl ? <a className="secondary-btn" href={result.detailUrl}>查看详情</a> : null}
                <a className="secondary-btn" href="/">返回首页</a>
              </div>
            </div>
          </div>
        ) : null}

        <div className="section" style={{ marginTop: 24 }}>
          <div style={{ display: 'grid', gap: 8 }}>
            <h3 style={{ margin: 0 }}>已上传书籍</h3>
            <p className="muted" style={{ margin: 0 }}>
              {localImportMode
                ? '这里只展示通过本地导入服务写入书库的书籍。'
                : 'Pages 发布模式下不会展示或删除本地导入书籍；线上上传会先进入待发布队列。'}
            </p>
          </div>

          {localImportMode && booksLoading ? (
            <div className="panel" style={{ marginTop: 12 }}>正在加载已上传书籍…</div>
          ) : null}

          {localImportMode && !booksLoading && books.length === 0 ? (
            <div className="panel" style={{ marginTop: 12 }}>当前还没有已导入的 EPUB 书籍。</div>
          ) : null}

          {localImportMode && !booksLoading && books.length > 0 ? (
            <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
              {books.map((book) => {
                const deleting = deletingBookId === book.id;
                return (
                  <article className="panel" key={book.id} style={{ display: 'grid', gap: 10 }}>
                    <div style={{ display: 'grid', gap: 6 }}>
                      <strong>{book.title}</strong>
                      <span className="muted">{book.author}</span>
                      <span className="muted">书籍 ID：{book.id}</span>
                    </div>
                    <div className="action-row">
                      <a className="secondary-btn" href={`/book/${book.id}`}>查看详情</a>
                      <button
                        className="primary-btn"
                        type="button"
                        onClick={() => deleteBook(book.id)}
                        disabled={uploading || deletingBookId !== null}
                        style={{ opacity: uploading || deletingBookId !== null ? 0.45 : 1 }}
                      >
                        {deleting ? '删除中…' : '删除'}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : null}

          {!localImportMode ? (
            <div className="panel" style={{ marginTop: 12 }}>当前模式下只提供 EPUB 校验结果，不读取本地导入书单。</div>
          ) : null}
        </div>
      </form>
    </section>
  );
}
