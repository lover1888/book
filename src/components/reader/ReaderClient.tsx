import { useEffect, useMemo, useState } from 'react';
import type { Book } from '../../lib/books';

type ReaderState = {
  theme: 'light' | 'dark' | 'sepia';
  fontSize: number;
  lineHeight: number;
  width: number;
};

type ShelfRecord = {
  bookId: string;
  title: string;
  cover: string;
  author: string;
  href: string;
  lastChapterId: string;
  lastChapterTitle: string;
  progress: number;
  updatedAt: string;
  favorite: boolean;
};

type Props = {
  book: Book;
  chapterId: string;
};

const settingsKey = (bookId: string) => `reader:settings:${bookId}`;
const progressKey = (bookId: string) => `reader:progress:${bookId}`;
const shelfKey = 'reader:local-shelf';

const defaultState: ReaderState = {
  theme: 'light',
  fontSize: 19,
  lineHeight: 1.95,
  width: 760
};

export default function ReaderClient({ book, chapterId }: Props) {
  const initialChapterIndex = Math.max(book.chapters.findIndex((chapter) => chapter.id === chapterId), 0);
  const [activeChapterIndex, setActiveChapterIndex] = useState(initialChapterIndex);
  const [state, setState] = useState<ReaderState>(defaultState);

  const chapter = book.chapters[activeChapterIndex] ?? book.chapters[0];
  const progressPercent = useMemo(() => Math.round(((activeChapterIndex + 1) / book.chapters.length) * 100), [activeChapterIndex, book.chapters.length]);

  useEffect(() => {
    const storedSettings = localStorage.getItem(settingsKey(book.id));
    const storedProgress = localStorage.getItem(progressKey(book.id));

    if (storedSettings) {
      try {
        setState((current) => ({ ...current, ...JSON.parse(storedSettings) }));
      } catch {}
    }

    if (storedProgress) {
      try {
        const parsed = JSON.parse(storedProgress) as { chapterId?: string };
        if (parsed.chapterId) {
          const savedIndex = book.chapters.findIndex((item) => item.id === parsed.chapterId);
          if (savedIndex >= 0) setActiveChapterIndex(savedIndex);
        }
      } catch {}
    }
  }, [book]);

  useEffect(() => {
    document.documentElement.dataset.theme = state.theme;
    document.documentElement.style.setProperty('--reader-font-size', `${state.fontSize}px`);
    document.documentElement.style.setProperty('--reader-line-height', String(state.lineHeight));
    document.documentElement.style.setProperty('--reader-width', `${state.width}px`);
    localStorage.setItem(settingsKey(book.id), JSON.stringify(state));
  }, [book.id, state]);

  useEffect(() => {
    const progressPayload = {
      bookId: book.id,
      chapterId: chapter.id,
      chapterTitle: chapter.title,
      progress: progressPercent,
      updatedAt: new Date().toISOString()
    };

    localStorage.setItem(progressKey(book.id), JSON.stringify(progressPayload));

    const rawShelf = localStorage.getItem(shelfKey);
    const shelf = rawShelf ? ((JSON.parse(rawShelf) as ShelfRecord[]) ?? []) : [];
    const nextRecord: ShelfRecord = {
      bookId: book.id,
      title: book.title,
      cover: book.cover,
      author: book.author,
      href: `/read/${book.id}`,
      lastChapterId: chapter.id,
      lastChapterTitle: chapter.title,
      progress: progressPercent,
      updatedAt: new Date().toISOString(),
      favorite: shelf.find((item) => item.bookId === book.id)?.favorite ?? false
    };

    const nextShelf = [nextRecord, ...shelf.filter((item) => item.bookId !== book.id)].slice(0, 12);
    localStorage.setItem(shelfKey, JSON.stringify(nextShelf));
  }, [book, chapter, progressPercent]);

  const updateState = (patch: Partial<ReaderState>) => {
    setState((current) => ({ ...current, ...patch }));
  };

  return (
    <div className="reader-layout">
      <aside className="reader-sidebar">
        <div style={{ display: 'grid', gap: 16 }}>
          <div>
            <p className="pill" style={{ width: 'max-content' }}>目录</p>
            <h2 style={{ margin: '10px 0 4px' }}>{book.title}</h2>
            <p className="muted" style={{ margin: 0 }}>{book.author}</p>
          </div>

          <div className="setting-grid">
            {book.chapters.map((item, index) => (
              <button
                key={item.id}
                className="chapter-link"
                aria-current={item.id === chapter.id ? 'true' : 'false'}
                onClick={() => setActiveChapterIndex(index)}
                style={{ border: 'none', textAlign: 'left', background: 'transparent', cursor: 'pointer' }}
              >
                <strong style={{ display: 'block', marginBottom: 4 }}>{item.title}</strong>
                <span className="muted" style={{ fontSize: '0.92rem' }}>{item.minutes} 分钟</span>
              </button>
            ))}
          </div>
        </div>
      </aside>

      <section className="reader-main">
        <div className="reader-toolbar">
          <div>
            <p className="muted" style={{ margin: 0 }}>{book.category}</p>
            <h1 className="reader-title" style={{ fontSize: '2rem', marginTop: 6 }}>{chapter.title}</h1>
          </div>
          <div className="action-row">
            <a className="secondary-btn" href={`/book/${book.id}`}>书籍详情</a>
          </div>
        </div>

        <div className="section panel" style={{ padding: 18, marginTop: 18 }}>
          <div className="grid-2">
            <div className="setting-grid">
              <div className="range-row">
                <label htmlFor="font-size">字号 {state.fontSize}px</label>
                <input id="font-size" type="range" min="16" max="26" value={state.fontSize} onChange={(event) => updateState({ fontSize: Number(event.target.value) })} />
              </div>
              <div className="range-row">
                <label htmlFor="line-height">行高 {state.lineHeight.toFixed(2)}</label>
                <input id="line-height" type="range" min="1.6" max="2.4" step="0.05" value={state.lineHeight} onChange={(event) => updateState({ lineHeight: Number(event.target.value) })} />
              </div>
            </div>
            <div className="setting-grid">
              <div className="range-row">
                <label htmlFor="reader-width">版心宽度 {state.width}px</label>
                <input id="reader-width" type="range" min="620" max="860" step="10" value={state.width} onChange={(event) => updateState({ width: Number(event.target.value) })} />
              </div>
              <div className="setting-row">
                <span>阅读主题</span>
                <div className="theme-toggle">
                  {(['light', 'sepia', 'dark'] as const).map((theme) => (
                    <button key={theme} type="button" data-active={state.theme === theme} onClick={() => updateState({ theme })}>
                      {theme === 'light' ? '浅色' : theme === 'sepia' ? '护眼' : '深色'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="reader-copy">
          <p className="muted" style={{ fontSize: '1rem', marginBottom: '1.6em' }}>{chapter.excerpt}</p>
          {chapter.content.map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </div>

        <div className="section panel" style={{ marginTop: 30 }}>
          <div className="metric-grid">
            <div className="metric-card">
              <div className="muted">阅读进度</div>
              <div style={{ fontSize: '1.6rem', fontWeight: 700, marginTop: 8 }}>{progressPercent}%</div>
              <div className="progress-bar" style={{ marginTop: 12 }}><span style={{ width: `${progressPercent}%` }} /></div>
            </div>
            <div className="metric-card">
              <div className="muted">当前章节</div>
              <div style={{ fontSize: '1.6rem', fontWeight: 700, marginTop: 8 }}>{activeChapterIndex + 1}/{book.chapters.length}</div>
              <div className="muted" style={{ marginTop: 8 }}>{chapter.minutes} 分钟</div>
            </div>
            <div className="metric-card">
              <div className="muted">本地状态</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, marginTop: 8 }}>自动续读</div>
              <div className="muted" style={{ marginTop: 8 }}>刷新后仍会回到当前章节</div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
