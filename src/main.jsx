import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';

const markdownModules = import.meta.glob('/content/**/*.md', { query: '?raw', import: 'default' });
const pictureModules = import.meta.glob('/pictures/*', { eager: true, query: '?url', import: 'default' });
const markdownCache = new Map();

function getPath() {
  return window.location.pathname || '/';
}

function navigate(to) {
  window.history.pushState({}, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function usePathname() {
  const [pathname, setPathname] = useState(getPath());

  useEffect(() => {
    const onPopState = () => setPathname(getPath());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  return pathname;
}

function parseFrontmatter(raw) {
  const match = raw.match(/^---\s*([\s\S]*?)\s*---\s*([\s\S]*)$/);
  if (!match) return { data: {}, body: raw.trim() };

  const data = {};
  for (const line of match[1].split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf(':');
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
    data[key] = value;
  }

  return { data, body: match[2].trim() };
}

function renderMarkdown(markdown) {
  const escapeHtml = (text) =>
    text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const formatInline = (text) => {
    const htmlTags = [];
    let output = text.replace(/<[^>]+>/g, (match) => {
      const token = `__HTML_TAG_${htmlTags.length}__`;
      htmlTags.push(match);
      return token;
    });
    output = escapeHtml(output);
    output = output.replace(/`([^`]+)`/g, '<code>$1</code>');
    output = output.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    output = output.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    output = output.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
    output = output.replace(/(?<!_)_([^_]+)_(?!_)/g, '<em>$1</em>');
    output = output.replace(/\[\[([^\]]+)\]\(([^)]+)\)\]/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
    output = output.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
    output = output.replace(/^\[([^]+)\]$/, '$1');
    output = output.replace(/__HTML_TAG_(\d+)__/g, (_, index) => htmlTags[Number(index)] || '');
    return output;
  };

  const lines = markdown.split('\n');
  const blocks = [];
  let paragraph = [];
  let listItems = [];
  let orderedItems = [];
  let inRawBlock = false;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(`<p>${paragraph.join(' ')}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (!listItems.length) return;
    blocks.push('<ul>');
    blocks.push(...listItems.map((item) => `<li>${formatInline(item)}</li>`));
    blocks.push('</ul>');
    listItems = [];
  };

  const flushOrderedList = () => {
    if (!orderedItems.length) return;
    blocks.push('<ol>');
    blocks.push(...orderedItems.map((item) => `<li>${formatInline(item)}</li>`));
    blocks.push('</ol>');
    orderedItems = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed.startsWith('<details') ||
      trimmed.startsWith('</details') ||
      trimmed.startsWith('<summary') ||
      trimmed.startsWith('</summary') ||
      trimmed.startsWith('<div') ||
      trimmed.startsWith('</div') ||
      trimmed.startsWith('<p') ||
      trimmed.startsWith('</p') ||
      trimmed.startsWith('<ul') ||
      trimmed.startsWith('</ul') ||
      trimmed.startsWith('<ol') ||
      trimmed.startsWith('</ol') ||
      trimmed.startsWith('<li') ||
      trimmed.startsWith('</li')
    ) {
      flushParagraph();
      flushList();
      flushOrderedList();
      blocks.push(trimmed);
      inRawBlock = trimmed.startsWith('<details');
      continue;
    }
    if (inRawBlock) {
      blocks.push(trimmed);
      if (trimmed.startsWith('</details')) inRawBlock = false;
      continue;
    }
    if (!trimmed) {
      flushParagraph();
      flushList();
      flushOrderedList();
      continue;
    }
    if (/^---+$/.test(trimmed)) {
      flushParagraph();
      flushList();
      flushOrderedList();
      blocks.push('<hr />');
      continue;
    }
    if (/^[-*+] /.test(trimmed)) {
      flushParagraph();
      flushOrderedList();
      listItems.push(trimmed.slice(2));
      continue;
    }
    const orderedMatch = trimmed.match(/^\d+\.\s+(.*)$/);
    if (orderedMatch) {
      flushParagraph();
      flushList();
      orderedItems.push(orderedMatch[1]);
      continue;
    }
    if (trimmed.startsWith('### ')) {
      flushParagraph();
      flushList();
      flushOrderedList();
      blocks.push(`<h3>${formatInline(trimmed.slice(4))}</h3>`);
      continue;
    }
    if (trimmed.startsWith('## ')) {
      flushParagraph();
      flushList();
      flushOrderedList();
      blocks.push(`<h2>${formatInline(trimmed.slice(3))}</h2>`);
      continue;
    }
    if (trimmed.startsWith('# ')) {
      flushParagraph();
      flushList();
      flushOrderedList();
      blocks.push(`<h1>${formatInline(trimmed.slice(2))}</h1>`);
      continue;
    }
    paragraph.push(formatInline(trimmed));
  }

  flushParagraph();
  flushList();
  flushOrderedList();
  return blocks.join('\n');
}

function loadMarkdownPage(slug) {
  const entry = Object.entries(markdownModules).find(([path]) => path.endsWith(slug));
  if (!entry) return null;
  if (markdownCache.has(slug)) return Promise.resolve(markdownCache.get(slug));
  return entry[1]().then((raw) => {
    const parsed = parseFrontmatter(raw);
    markdownCache.set(slug, parsed);
    return parsed;
  });
}

function resolvePicturePath(query, fallbackIndex = 0) {
  if (query.startsWith('/pictures/')) {
    return query;
  }

  const files = Object.entries(pictureModules).map(([path, url]) => ({
    filename: path.split('/').pop().toLowerCase(),
    url,
  }));

  const normalized = query.toLowerCase();
  const matched =
    files.find((file) => file.filename.includes(normalized)) ||
    files.find((file) => file.filename.includes('zhou')) ||
    files.find((file) => file.filename.includes('qian')) ||
    files[fallbackIndex] ||
    files[0];

  return matched?.url || '';
}

function Neko() {
  return (
    <div className="neko-stage" aria-hidden="true">
      <span className="neko-face blink-a">[=•ﻌ•=]</span>
      <span className="neko-face blink-b">[=-ﻌ-=]</span>
    </div>
  );
}

function Topbar({ navigateTo }) {
  return (
    <header className="topbar">
      <button className="button-reset home-link" onClick={() => navigateTo('/')}>Home</button>
      <nav className="menu" aria-label="Primary">
        <button className="button-reset nav-link" onClick={() => navigateTo('/about')}>About</button>
        <button className="button-reset nav-link" onClick={() => navigateTo('/blogs')}>Blogs</button>
        <button className="button-reset nav-link" onClick={() => navigateTo('/projects')}>Projects</button>
        <button className="button-reset nav-link" onClick={() => navigateTo('/contacts')}>Contacts</button>
        <Neko />
      </nav>
    </header>
  );
}

function ProfileCard({ owner }) {
  const bioLines = owner.bio.split('\n').filter(Boolean);
  return (
    <article className="person-card single-panel">
      <img className="avatar" src={owner.avatar} alt={owner.name} />
      <h2>{owner.name}</h2>
      <h3 className="role">{owner.role}</h3>
      <div className="bio bio-list">
        <ul>
          {bioLines.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
      <button
        className="button-reset arrow-btn"
        onClick={() => navigate(owner.aboutUrl)}
        aria-label={`Open ${owner.name} about page`}
      >
        <span className="arrow-glyph">→</span>
      </button>
    </article>
  );
}

function MarkdownPage({ slug, fallbackTitle }) {
  const [page, setPage] = useState(null);

  useEffect(() => {
    let alive = true;
    setPage(null);
    loadMarkdownPage(slug).then((result) => {
      if (alive) setPage(result);
    });
    return () => {
      alive = false;
    };
  }, [slug]);

  if (!page) {
    return (
      <main className="page-shell">
        <article className="about-card">
          <p className="eyebrow">Loading</p>
          <h1>{fallbackTitle}</h1>
        </article>
      </main>
    );
  }

  const title = page?.data?.title || fallbackTitle;
  const avatar = page?.data?.avatar ? resolvePicturePath(page.data.avatar) : '';
  const html = renderMarkdown(page?.body || `# ${title}\n\nContent coming soon.`);

  return (
    <main className="page-shell">
      <article className="about-card">
        {avatar ? <img className="page-avatar" src={avatar} alt={title} /> : null}
        <h1>{title}</h1>
        <div className="content" dangerouslySetInnerHTML={{ __html: html }} />
      </article>
    </main>
  );
}

function HomePage() {
  const owner = {
    name: 'Haoyi Li',
    role: 'AI Agent Engineer at Alibaba Group',
    bio: `Hi👋, welcome here!
Click the arrow below to learn more about me!`,
    avatar: resolvePicturePath('qianxia', 0),
    aboutUrl: '/about',
  };

  return (
    <main className="home-shell">
      <section className="split-home">
        <div className="left-bg" />
        <div className="right-bg" />
        <ProfileCard owner={owner} />
      </section>
    </main>
  );
}

function App() {
  const pathname = usePathname();

  let page;
  if (pathname === '/about') {
    page = <MarkdownPage slug="/content/about/haoyi.en.md" fallbackTitle="Haoyi Li" />;
  } else if (pathname === '/blogs') {
    page = <MarkdownPage slug="/content/pages/blogs.en.md" fallbackTitle="Blogs" />;
  } else if (pathname === '/projects') {
    page = <MarkdownPage slug="/content/pages/projects.en.md" fallbackTitle="Projects" />;
  } else if (pathname === '/contacts') {
    page = <MarkdownPage slug="/content/pages/contacts.en.md" fallbackTitle="Contacts" />;
  } else {
    page = <HomePage />;
  }

  return (
    <div className="app-shell">
      <Topbar navigateTo={navigate} />
      {page}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
