/**
 * FILE PARSER — supports ALL formats
 * Used by know.js CLI
 */

const path = require('path');
const fs = require('fs');

const SUPPORTED = {
  text: ['.txt', '.md', '.log', '.csv', '.tsv', '.rtf', '.text'],
  code: ['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.c', '.cpp',
         '.h', '.cs', '.go', '.rs', '.rb', '.php', '.swift', '.kt',
         '.html', '.css', '.scss', '.sass', '.less', '.xml', '.yaml',
         '.yml', '.json', '.toml', '.ini', '.env', '.sh', '.bash',
         '.zsh', '.fish', '.ps1', '.bat', '.cmd', '.sql', '.graphql',
         '.proto', '.tf', '.vue', '.svelte', '.astro'],
  document: ['.pdf', '.docx', '.doc', '.odt', '.rtf', '.epub'],
  data: ['.csv', '.tsv', '.json', '.jsonl', '.ndjson'],
  image: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'],
  archive: ['.zip', '.tar', '.gz', '.rar'],
};

const ALL_SUPPORTED = Object.values(SUPPORTED).flat();

async function parseFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const filename = path.basename(filePath);
  const stat = fs.statSync(filePath);
  const sizeMB = (stat.size / 1024 / 1024).toFixed(2);

  if (stat.size > 50 * 1024 * 1024) {
    throw new Error(`File too large (${sizeMB}MB). Max 50MB.`);
  }

  // Text / Code files
  if ([...SUPPORTED.text, ...SUPPORTED.code].includes(ext)) {
    const content = fs.readFileSync(filePath, 'utf-8');
    return {
      content,
      fileType: ext.slice(1),
      encoding: 'utf-8',
      size: stat.size,
      chunks: chunkText(content, 4000),
    };
  }

  // JSON files - pretty print
  if (ext === '.json' || ext === '.jsonl' || ext === '.ndjson') {
    const raw = fs.readFileSync(filePath, 'utf-8');
    let content;
    try {
      if (ext === '.jsonl' || ext === '.ndjson') {
        const lines = raw.trim().split('\n').filter(Boolean);
        content = lines.map((l, i) => `[${i+1}] ${JSON.stringify(JSON.parse(l), null, 2)}`).join('\n\n');
      } else {
        content = JSON.stringify(JSON.parse(raw), null, 2);
      }
    } catch {
      content = raw;
    }
    return { content, fileType: 'json', size: stat.size, chunks: chunkText(content, 4000) };
  }

  // PDF
  if (ext === '.pdf') {
    try {
      const pdfParse = require('pdf-parse');
      const buffer = fs.readFileSync(filePath);
      const data = await pdfParse(buffer);
      const content = data.text.replace(/\s{3,}/g, '\n\n').trim();
      return {
        content,
        fileType: 'pdf',
        pages: data.numpages,
        size: stat.size,
        chunks: chunkText(content, 4000),
        metadata: data.info,
      };
    } catch (e) {
      throw new Error(`PDF parse failed: ${e.message}. Run: npm install pdf-parse`);
    }
  }

  // DOCX / DOC
  if (ext === '.docx' || ext === '.doc') {
    try {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ path: filePath });
      const content = result.value.trim();
      return {
        content,
        fileType: 'docx',
        size: stat.size,
        chunks: chunkText(content, 4000),
      };
    } catch (e) {
      throw new Error(`DOCX parse failed: ${e.message}. Run: npm install mammoth`);
    }
  }

  // CSV - convert to readable format
  if (ext === '.csv' || ext === '.tsv') {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const sep = ext === '.tsv' ? '\t' : ',';
    const lines = raw.trim().split('\n');
    const headers = lines[0].split(sep).map(h => h.trim().replace(/"/g, ''));
    const rows = lines.slice(1).map(line => {
      const vals = line.split(sep).map(v => v.trim().replace(/"/g, ''));
      return headers.reduce((obj, h, i) => ({ ...obj, [h]: vals[i] || '' }), {});
    });
    const content = `Headers: ${headers.join(', ')}\n\nTotal rows: ${rows.length}\n\nData:\n`
      + rows.slice(0, 500).map((r, i) => `[${i+1}] ` + Object.entries(r).map(([k,v]) => `${k}: ${v}`).join(' | ')).join('\n');
    return { content, fileType: 'csv', rows: rows.length, size: stat.size, chunks: chunkText(content, 4000) };
  }

  // EPUB
  if (ext === '.epub') {
    try {
      const EPub = require('epub');
      return new Promise((resolve, reject) => {
        const epub = new EPub(filePath);
        epub.on('end', () => {
          const items = epub.flow.filter(f => f.id);
          let fullText = '';
          let count = 0;
          items.forEach(item => {
            epub.getChapter(item.id, (err, text) => {
              if (!err && text) {
                fullText += text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ') + '\n\n';
              }
              count++;
              if (count === items.length) {
                resolve({
                  content: fullText.trim(),
                  fileType: 'epub',
                  size: stat.size,
                  chunks: chunkText(fullText, 4000),
                });
              }
            });
          });
        });
        epub.on('error', reject);
        epub.parse();
      });
    } catch (e) {
      throw new Error(`EPUB parse failed. Run: npm install epub`);
    }
  }

  // Images - describe metadata
  if (SUPPORTED.image.includes(ext)) {
    const content = `[Image File]\nFilename: ${filename}\nFormat: ${ext.slice(1).toUpperCase()}\nSize: ${sizeMB}MB\n\nNote: Image stored as reference. Content description not available without vision model.`;
    return { content, fileType: 'image', size: stat.size, chunks: [content] };
  }

  // Fallback - try as text
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return { content, fileType: ext.slice(1) || 'unknown', size: stat.size, chunks: chunkText(content, 4000) };
  } catch {
    throw new Error(`Cannot read file type: ${ext}. Supported: ${ALL_SUPPORTED.join(', ')}`);
  }
}

function chunkText(text, maxChars) {
  if (text.length <= maxChars) return [text];
  const chunks = [];
  // Split by paragraphs first
  const paragraphs = text.split(/\n{2,}/);
  let current = '';
  for (const para of paragraphs) {
    if ((current + para).length > maxChars && current) {
      chunks.push(current.trim());
      current = para + '\n\n';
    } else {
      current += para + '\n\n';
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

function getAllFiles(dir, recursive = true) {
  const results = [];
  const items = fs.readdirSync(dir);
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory() && recursive) {
      results.push(...getAllFiles(fullPath, recursive));
    } else if (stat.isFile()) {
      const ext = path.extname(item).toLowerCase();
      if (ALL_SUPPORTED.includes(ext)) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

module.exports = { parseFile, chunkText, getAllFiles, SUPPORTED, ALL_SUPPORTED };
