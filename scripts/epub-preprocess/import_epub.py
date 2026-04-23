from __future__ import annotations

import hashlib
import json
import re
import sys
import textwrap
import zipfile
from datetime import date
from pathlib import Path, PurePosixPath
import xml.etree.ElementTree as ET
from lxml import etree as LET

XHTML_NS = 'http://www.w3.org/1999/xhtml'
OPF_NS = 'http://www.idpf.org/2007/opf'
DC_NS = 'http://purl.org/dc/elements/1.1/'
CONTAINER_NS = 'urn:oasis:names:tc:opendocument:xmlns:container'
NS = {
    'xhtml': XHTML_NS,
    'opf': OPF_NS,
    'dc': DC_NS,
    'container': CONTAINER_NS,
}

ROOT = Path('/home/kaixin/work-ai/reader')
OUTPUT_JSON = ROOT / 'src/lib/imported-books.json'
OUTPUT_BOOKS_DIR = ROOT / 'public/books'
RAW_UPLOAD_DIR = ROOT / 'public/uploads/raw'

def ascii_slug(value: str) -> str:
    value = value.strip().lower()
    value = re.sub(r'[^a-z0-9]+', '-', value)
    value = re.sub(r'-+', '-', value).strip('-')
    return value


def build_book_id(title: str, author: str) -> str:
    slug = ascii_slug(title)
    if slug:
        return slug
    digest = hashlib.sha1(f'{title}\n{author}'.encode('utf-8')).hexdigest()[:10]
    return f'book-{digest}'


def text_content(node: ET.Element) -> str:
    return re.sub(r'\s+', ' ', ''.join(node.itertext())).strip()


def find_element_by_id(root: ET.Element, element_id: str) -> ET.Element | None:
    for element in root.iter():
        if element.attrib.get('id') == element_id:
            return element
    return None


def append_text(paragraphs: list[str], value: str) -> None:
    text = re.sub(r'\s+', ' ', value).strip()
    if text and text not in paragraphs:
        paragraphs.append(text)



def extract_block_texts(root: ET.Element) -> list[str]:
    paragraphs: list[str] = []
    block_tags = {'section', 'article', 'div', 'p', 'li', 'blockquote', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'}

    append_text(paragraphs, root.text or '')
    for child in list(root):
        tag = child.tag.rsplit('}', 1)[-1]
        if tag in block_tags:
            append_text(paragraphs, text_content(child))
        else:
            append_text(paragraphs, child.text or '')
        append_text(paragraphs, child.tail or '')

    return paragraphs


def extract_paragraphs(root: ET.Element) -> list[str]:
    paragraphs = []
    for paragraph in root.findall('.//xhtml:p', NS):
        text = text_content(paragraph)
        if text:
            paragraphs.append(text)
    if paragraphs:
        return paragraphs

    paragraphs = extract_block_texts(root)
    if paragraphs:
        return paragraphs

    text = text_content(root)
    return [text] if text else []


def minutes_for_paragraphs(paragraphs: list[str]) -> int:
    chars = sum(len(item) for item in paragraphs)
    return max(3, round(chars / 260))


def split_title_lines(title: str, max_chars_per_line: int = 9) -> list[str]:
    compact = re.sub(r'\s+', ' ', title).strip()
    if not compact:
        return ['未命名书籍']

    lines: list[str] = []
    current = ''
    for char in compact:
        current += char
        if len(current) >= max_chars_per_line:
            lines.append(current)
            current = ''
        if len(lines) == 2:
            break

    if len(lines) < 2 and current:
        lines.append(current)

    if len(lines) > 2:
        lines = lines[:2]
    if len(lines) == 2 and len(''.join(lines)) < len(compact):
        lines[1] = lines[1][:-1] + '…' if len(lines[1]) >= 1 else '…'

    return lines


def fallback_cover_svg(title: str, author: str) -> str:
    safe_title = title.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    safe_author = author.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    title_lines = [line.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;') for line in split_title_lines(title)]
    title_tspans = ''.join(
        f'<tspan x="400" dy="{dy}">{line}</tspan>'
        for index, line in enumerate(title_lines)
        for dy in [('0' if index == 0 else '1.1em')]
    )
    return textwrap.dedent(f'''\
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1200" role="img" aria-label="{safe_title} 封面">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#f5efe2" />
          <stop offset="100%" stop-color="#dfd0b0" />
        </linearGradient>
      </defs>
      <rect width="800" height="1200" rx="48" fill="url(#bg)" />
      <rect x="74" y="74" width="652" height="1052" rx="36" fill="none" stroke="#8a5a2b" stroke-width="3" stroke-dasharray="8 10" />
      <text x="400" y="350" text-anchor="middle" font-size="64" fill="#5b3a1f" font-family="serif">经典导入</text>
      <text x="400" y="500" text-anchor="middle" font-size="82" fill="#2d1d0f" font-family="serif">{title_tspans}</text>
      <text x="400" y="655" text-anchor="middle" font-size="34" fill="#6e4a28" font-family="sans-serif">{safe_author}</text>
      <text x="400" y="980" text-anchor="middle" font-size="28" fill="#7d5d39" font-family="sans-serif">EPUB 预处理导入</text>
    </svg>
    ''').strip() + '\n'


def load_container_root(zip_file: zipfile.ZipFile) -> PurePosixPath:
    container = ET.fromstring(zip_file.read('META-INF/container.xml'))
    rootfile = container.find('.//container:rootfile', NS)
    if rootfile is None:
        raise RuntimeError('EPUB 缺少 rootfile')
    return PurePosixPath(rootfile.attrib['full-path'])


def parse_xml_or_recover(content: bytes, error_message: str) -> ET.Element:
    try:
        return ET.fromstring(content)
    except ET.ParseError:
        parser = LET.XMLParser(recover=True)
        root = LET.fromstring(content, parser=parser)
        if root is None:
            raise RuntimeError(error_message)
        return ET.fromstring(LET.tostring(root, encoding='utf-8'))


def parse_book(epub_path: Path, raw_target: str | None = None) -> dict:
    with zipfile.ZipFile(epub_path) as archive:
        opf_path = load_container_root(archive)
        opf_dir = opf_path.parent
        package = parse_xml_or_recover(archive.read(str(opf_path)), 'OPF 解析失败。')
        title = package.findtext('.//dc:title', default='未命名书籍', namespaces=NS).strip()
        author = package.findtext('.//dc:creator', default='佚名', namespaces=NS).strip() or '佚名'
        language = package.findtext('.//dc:language', default='zh-CN', namespaces=NS).strip() or 'zh-CN'

        nav_item = package.find('.//opf:item[@properties="nav"]', NS)
        if nav_item is None:
            raise RuntimeError('EPUB 缺少 nav.xhtml')
        nav_path = opf_dir / nav_item.attrib['href']
        nav_tree = parse_xml_or_recover(archive.read(str(nav_path)), '导航文件解析失败。')

        chapters = []
        word_count = 0
        for index, anchor in enumerate(nav_tree.findall('.//xhtml:a', NS), start=1):
            href_value = anchor.attrib.get('href', '')
            href, _, fragment = href_value.partition('#')
            if not href:
                continue
            chapter_path = opf_dir / href
            chapter_tree = parse_xml_or_recover(archive.read(str(chapter_path)), f'章节解析失败: {chapter_path.name}')
            chapter_root = find_element_by_id(chapter_tree, fragment) if fragment else chapter_tree
            if chapter_root is None:
                chapter_root = chapter_tree
            chapter_title = text_content(anchor) or f'第 {index} 章'
            paragraphs = extract_paragraphs(chapter_root)
            if not paragraphs:
                continue
            excerpt = paragraphs[0][:88]
            word_count += sum(len(item) for item in paragraphs)
            chapters.append(
                {
                    'id': f'chapter-{index}',
                    'title': chapter_title,
                    'excerpt': excerpt,
                    'content': paragraphs,
                    'minutes': minutes_for_paragraphs(paragraphs),
                }
            )

        if not chapters:
            raise RuntimeError('没有解析到可用章节')

        book_id = 'liuzu-tanjing' if '六祖坛经' in title else build_book_id(title, author)
        cover_dir = OUTPUT_BOOKS_DIR / book_id
        cover_dir.mkdir(parents=True, exist_ok=True)
        cover_path = cover_dir / 'cover.svg'
        cover_path.write_text(fallback_cover_svg(title, author), encoding='utf-8')

        intro = chapters[0]['excerpt']
        description = (
            f'《{title}》由提供的 EPUB 离线预处理导入，当前站点以静态发布方式展示正文。'
            f'全书共 {len(chapters)} 章，保留目录结构，并复用现有沉浸式阅读器与本地续读能力。'
        )

        book = {
            'id': book_id,
            'title': title,
            'author': author,
            'cover': f'/books/{book_id}/cover.svg',
            'category': '佛学经典' if language.startswith('zh') else 'Imported EPUB',
            'intro': intro,
            'description': description,
            'tags': ['EPUB 导入', '经典', '静态发布'],
            'wordCount': word_count,
            'lastUpdated': date.today().isoformat(),
            'featured': False,
            'chapters': chapters,
        }
        if raw_target:
            book['rawTarget'] = raw_target
        return book


def load_existing_books() -> list[dict]:
    if not OUTPUT_JSON.exists():
        return []
    try:
        content = json.loads(OUTPUT_JSON.read_text(encoding='utf-8'))
    except json.JSONDecodeError:
        return []
    return content if isinstance(content, list) else []


def merge_book(existing_books: list[dict], book: dict) -> list[dict]:
    merged = [item for item in existing_books if item.get('id') != book['id']]
    merged.append(book)
    return merged


def import_book(epub_path: Path, raw_target: str | None = None) -> dict:
    book = parse_book(epub_path, raw_target=raw_target)
    books = merge_book(load_existing_books(), book)
    OUTPUT_JSON.write_text(json.dumps(books, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return book


def print_result(book: dict) -> None:
    print(json.dumps({
        'bookId': book['id'],
        'title': book['title'],
        'author': book['author'],
        'cover': book['cover'],
        'detailUrl': f"/book/{book['id']}",
        'readUrl': f"/read/{book['id']}"
    }, ensure_ascii=False))





def main() -> int:
    if len(sys.argv) > 1:
        epub_path = Path(sys.argv[1]).expanduser().resolve()
    else:
        epub_path = Path('/home/kaixin/work-ai/baba-read/六祖坛经.epub')

    raw_target = sys.argv[2] if len(sys.argv) > 2 else None

    if not epub_path.exists():
        raise SystemExit(f'EPUB 不存在: {epub_path}')

    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    RAW_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

    book = import_book(epub_path, raw_target=raw_target)
    print_result(book)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
