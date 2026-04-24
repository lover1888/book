import { useEffect, useMemo, useState } from 'react';

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

const shelfKey = 'reader:local-shelf';

type LocalShelfClientProps = {
  validBookIds: string[];
};

export default function LocalShelfClient({ validBookIds }: LocalShelfClientProps) {
  const [items, setItems] = useState<ShelfRecord[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(shelfKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as ShelfRecord[];
      const allowedBookIds = new Set(validBookIds);
      const next = parsed.filter((item) => allowedBookIds.has(item.bookId));
      if (next.length !== parsed.length) {
        localStorage.setItem(shelfKey, JSON.stringify(next));
      }
      setItems(next);
    } catch {}
  }, [validBookIds]);

  const empty = useMemo(() => items.length === 0, [items]);

  const toggleFavorite = (bookId: string) => {
    setItems((current) => {
      const next = current.map((item) => (item.bookId === bookId ? { ...item, favorite: !item.favorite } : item));
      localStorage.setItem(shelfKey, JSON.stringify(next));
      return next;
    });
  };

  if (empty) {
    return (
      <section className="panel section">
        <h3>你的本地书架还是空的</h3>
        <p className="muted">先从发现页或书籍详情页进入阅读器，系统会自动把最近阅读加入本地书架。</p>
        <a className="primary-btn" href="/">去发现页</a>
      </section>
    );
  }

  return (
    <div className="grid-2 section">
      {items.map((item) => (
        <article className="shelf-card" key={item.bookId}>
          <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 16 }}>
            <div className="detail-cover">
              <img src={item.cover} alt={`${item.title} 封面`} />
            </div>
            <div style={{ display: 'grid', gap: 10 }}>
              <div>
                <h3>{item.title}</h3>
                <p className="muted" style={{ margin: '6px 0 0' }}>{item.author}</p>
              </div>
              <p className="muted" style={{ margin: 0 }}>上次读到：{item.lastChapterTitle}</p>
              <div className="progress-bar"><span style={{ width: `${item.progress}%` }} /></div>
              <div className="action-row">
                <a className="primary-btn" href={item.href}>继续阅读</a>
                <button className="secondary-btn" type="button" onClick={() => toggleFavorite(item.bookId)}>
                  {item.favorite ? '取消收藏' : '加入收藏'}
                </button>
              </div>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
