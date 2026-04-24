import importedBooksData from './imported-books.json';
import { isLocalImportMode } from './runtime-mode';

export type BookChapter = {
  id: string;
  title: string;
  excerpt: string;
  content: string[];
  minutes: number;
};

export type Book = {
  id: string;
  title: string;
  author: string;
  cover: string;
  category: string;
  intro: string;
  description: string;
  tags: string[];
  wordCount: number;
  lastUpdated: string;
  featured?: boolean;
  chapters: BookChapter[];
};

const LOCAL_IMPORT_BOOKS_URL = 'http://127.0.0.1:4327/books/full';
const LOCAL_BOOKS_TTL_MS = 1500;

let cachedLocalBooks: Book[] | null = null;
let cachedLocalBooksAt = 0;

async function readLocalImportedBooks() {
  const now = Date.now();
  if (cachedLocalBooks && now - cachedLocalBooksAt < LOCAL_BOOKS_TTL_MS) {
    return cachedLocalBooks;
  }

  try {
    const response = await fetch(LOCAL_IMPORT_BOOKS_URL);
    if (!response.ok) {
      throw new Error('failed to load local books');
    }

    const data = await response.json();
    const books = Array.isArray(data?.books) ? (data.books as Book[]) : [];
    cachedLocalBooks = books;
    cachedLocalBooksAt = now;
    return books;
  } catch {
    return null;
  }
}

function readStaticImportedBooks() {
  return Array.isArray(importedBooksData) ? (importedBooksData as Book[]) : [];
}

async function readImportedBooks() {
  if (isLocalImportMode()) {
    const localBooks = await readLocalImportedBooks();
    if (localBooks) {
      return localBooks;
    }
  }

  return readStaticImportedBooks();
}

export function invalidateBooksCache() {
  cachedLocalBooks = null;
  cachedLocalBooksAt = 0;
}

export async function getBooks() {
  const books = (await readImportedBooks())
    .slice()
    .sort((a, b) => b.lastUpdated.localeCompare(a.lastUpdated));

  if (!books.some((book) => book.featured) && books[0]) {
    books[0] = { ...books[0], featured: true };
  }

  return books;
}

export async function getFeaturedBooks() {
  return (await getBooks()).filter((book) => book.featured);
}

export async function getBook(bookId: string) {
  return (await getBooks()).find((book) => book.id === bookId);
}

export async function getChapter(bookId: string, chapterId?: string) {
  const book = await getBook(bookId);
  if (!book) return undefined;
  if (!chapterId) return book.chapters[0];
  return book.chapters.find((chapter) => chapter.id === chapterId) ?? book.chapters[0];
}
