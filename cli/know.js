#!/usr/bin/env node
/**
 * ╔══════════════════════════════════════╗
 * ║  KNOW — Knowledge Base CLI Manager  ║
 * ║  For Termux / Linux                 ║
 * ║  Usage: node cli/know.js [command]  ║
 * ╚══════════════════════════════════════╝
 *
 * Commands:
 *   list              - List all knowledge
 *   add               - Add knowledge interactively
 *   upload <path>     - Upload file or folder
 *   search <query>    - Full-text search
 *   delete <id>       - Delete by ID
 *   edit <id>         - Edit knowledge
 *   stats             - Show stats
 *   export [path]     - Export all to JSON
 *   import <json>     - Import from JSON backup
 *   tags <id> <tags>  - Set tags
 *   clear-all         - Delete ALL knowledge (confirm)
 *   help              - Show help
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { createClient } = require('@supabase/supabase-js');
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const { parseFile, getAllFiles, ALL_SUPPORTED } = require('./fileParser');

// ── Supabase ──
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ── Owner key check ──
const OWNER_KEY = process.env.OWNER_SECRET;

// ── Colors ──
const C = {
  r: '\x1b[0m',
  b: '\x1b[1m',
  d: '\x1b[2m',
  w: '\x1b[37m',
  g: '\x1b[32m',
  y: '\x1b[33m',
  r_: '\x1b[31m',
  c: '\x1b[36m',
  m: '\x1b[35m',
  bg: '\x1b[40m',
  bw: '\x1b[47m\x1b[30m',
};

const bold = s => C.b + s + C.r;
const dim = s => C.d + s + C.r;
const green = s => C.g + s + C.r;
const yellow = s => C.y + s + C.r;
const red = s => C.r_ + s + C.r;
const cyan = s => C.c + s + C.r;
const mag = s => C.m + s + C.r;

// ── RL helper ──
function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(r => rl.question(question, ans => { rl.close(); r(ans.trim()); }));
}

function askMultiline(prompt) {
  console.log(dim('  (Type content. Enter empty line twice to finish)'));
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(r => {
    const lines = [];
    let emptyCount = 0;
    rl.on('line', line => {
      if (line === '') { emptyCount++; if (emptyCount >= 2) { rl.close(); r(lines.join('\n').trim()); } else lines.push(line); }
      else { emptyCount = 0; lines.push(line); }
    });
  });
}

// ── Header ──
function printHeader() {
  console.log('\n' + bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(bold('  ∎  KNOW — Knowledge Base Manager'));
  console.log(bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━') + '\n');
}

function printDivider() {
  console.log(dim('  ────────────────────────────────────────'));
}

// ── Spinner ──
function spinner(text) {
  const frames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
  let i = 0;
  const iv = setInterval(() => {
    process.stdout.write(`\r  ${cyan(frames[i++ % frames.length])} ${text}  `);
  }, 80);
  return { stop: (msg='') => { clearInterval(iv); process.stdout.write(`\r  ${msg}\n`); }};
}

// ══════════════════════════════════════
// COMMANDS
// ══════════════════════════════════════

// LIST
async function cmdList(args) {
  printHeader();
  const category = args[0] || null;
  const spin = spinner('Fetching knowledge...');
  
  let query = supabase.from('knowledge').select('*').order('created_at', { ascending: false });
  if (category) query = query.eq('category', category);
  
  const { data, error } = await query;
  spin.stop();
  
  if (error) { console.log(red('  Error: ' + error.message)); return; }
  if (!data.length) { console.log(dim('  No knowledge stored yet. Use: node cli/know.js upload <file>')); return; }

  console.log(bold(`  ${data.length} item(s) stored\n`));
  data.forEach((k, i) => {
    console.log(`  ${bold(String(i+1).padStart(3, '0'))}  ${bold(k.title)}`);
    console.log(`       ${dim('['  + k.category + ']')} ${dim(k.id)}`);
    console.log(`       ${dim(k.content.slice(0, 80).replace(/\n/g, ' ') + '...')}`);
    if (k.tags && k.tags.length) console.log(`       ${cyan('Tags: ' + k.tags.join(', '))}`);
    console.log(`       ${dim(new Date(k.created_at).toLocaleString('id-ID'))}`);
    console.log();
  });
}

// SEARCH
async function cmdSearch(args) {
  const q = args.join(' ');
  if (!q) { console.log(red('  Usage: node cli/know.js search <query>')); return; }
  
  printHeader();
  const spin = spinner(`Searching: "${q}"...`);
  
  const { data, error } = await supabase
    .from('knowledge')
    .select('*')
    .or(`title.ilike.%${q}%,content.ilike.%${q}%`)
    .order('created_at', { ascending: false });
  
  spin.stop();
  if (error) { console.log(red('  Error: ' + error.message)); return; }
  
  console.log(bold(`  Found ${data.length} result(s) for: "${q}"\n`));
  data.forEach((k, i) => {
    const preview = k.content.toLowerCase().indexOf(q.toLowerCase());
    const snippet = preview >= 0
      ? '...' + k.content.slice(Math.max(0, preview-30), preview+80) + '...'
      : k.content.slice(0, 100);
    
    console.log(`  ${bold(k.title)} ${dim('[' + k.category + ']')}`);
    console.log(`  ${dim(k.id)}`);
    console.log(`  ${snippet.replace(/\n/g, ' ')}`);
    console.log();
  });
}

// ADD (interactive)
async function cmdAdd() {
  printHeader();
  console.log(bold('  Add New Knowledge\n'));
  
  const title = await ask('  Title: ');
  if (!title) { console.log(red('  Title required!')); return; }
  
  console.log('  Category (general/tech/personal/ctf/note/other) [general]: ');
  const category = await ask('  > ') || 'general';
  
  console.log('\n  Content:');
  const content = await askMultiline('');
  if (!content) { console.log(red('  Content required!')); return; }
  
  const tagsRaw = await ask('\n  Tags (comma separated, optional): ');
  const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];
  
  const spin = spinner('Saving...');
  const { data, error } = await supabase
    .from('knowledge')
    .insert([{ title, content, category, tags }])
    .select();
  
  spin.stop();
  if (error) { console.log(red('  Error: ' + error.message)); return; }
  console.log(green(`  ✓ Saved! ID: ${data[0].id}`));
}

// UPLOAD file or folder
async function cmdUpload(args) {
  const target = args[0];
  if (!target) {
    console.log(red('  Usage: node cli/know.js upload <file_or_folder> [--category=name] [--recursive]'));
    return;
  }

  const absPath = path.resolve(target);
  if (!fs.existsSync(absPath)) { console.log(red('  Path not found: ' + absPath)); return; }

  const categoryArg = args.find(a => a.startsWith('--category='));
  const category = categoryArg ? categoryArg.split('=')[1] : 'file-upload';
  const recursive = args.includes('--recursive') || args.includes('-r');

  printHeader();

  const stat = fs.statSync(absPath);
  let files = [];

  if (stat.isDirectory()) {
    console.log(bold(`  Scanning folder: ${absPath}\n`));
    files = getAllFiles(absPath, recursive);
    console.log(dim(`  Found ${files.length} supported file(s)\n`));
    if (!files.length) {
      console.log(yellow('  No supported files found.'));
      console.log(dim('  Supported: ' + ALL_SUPPORTED.join(' ')));
      return;
    }
  } else {
    files = [absPath];
  }

  let ok = 0, fail = 0;

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const fname = path.basename(f);
    const spin = spinner(`[${i+1}/${files.length}] ${fname}`);

    try {
      const parsed = await parseFile(f);
      const title = fname;
      const { chunks, fileType } = parsed;

      for (let ci = 0; ci < chunks.length; ci++) {
        const chunkTitle = chunks.length > 1
          ? `${title} [${ci+1}/${chunks.length}]`
          : title;

        const { error } = await supabase.from('knowledge').insert([{
          title: chunkTitle,
          content: chunks[ci],
          category,
          source_file: f,
          file_type: fileType,
          tags: [fileType, category],
        }]);

        if (error) throw new Error(error.message);
      }

      spin.stop(green(`  ✓ ${fname} — ${chunks.length} chunk(s), ${(parsed.size/1024).toFixed(1)}KB`));
      ok++;
    } catch (e) {
      spin.stop(red(`  ✕ ${fname} — ${e.message}`));
      fail++;
    }
  }

  printDivider();
  console.log(bold(`\n  Upload complete: ${green(ok + ' OK')} ${fail ? red(fail + ' failed') : ''}\n`));
}

// DELETE
async function cmdDelete(args) {
  const id = args[0];
  if (!id) { console.log(red('  Usage: node cli/know.js delete <id>')); return; }

  printHeader();
  
  // Fetch first
  const { data: existing } = await supabase.from('knowledge').select('*').eq('id', id).single();
  if (!existing) { console.log(red('  Knowledge not found: ' + id)); return; }

  console.log(`  Title: ${bold(existing.title)}`);
  console.log(`  Category: ${dim(existing.category)}`);
  console.log(`  Content: ${dim(existing.content.slice(0, 100))}...\n`);

  const confirm = await ask(red('  Delete this? (yes/no): '));
  if (confirm !== 'yes') { console.log(yellow('  Cancelled.')); return; }

  const { error } = await supabase.from('knowledge').delete().eq('id', id);
  if (error) { console.log(red('  Error: ' + error.message)); return; }
  console.log(green('  ✓ Deleted!'));
}

// EDIT
async function cmdEdit(args) {
  const id = args[0];
  if (!id) { console.log(red('  Usage: node cli/know.js edit <id>')); return; }

  printHeader();
  const { data: existing, error: fetchErr } = await supabase.from('knowledge').select('*').eq('id', id).single();
  if (fetchErr || !existing) { console.log(red('  Not found: ' + id)); return; }

  console.log(bold('  Editing: ' + existing.title));
  console.log(dim('  Leave blank to keep current value\n'));

  const title = await ask(`  New title [${existing.title}]: `) || existing.title;
  const category = await ask(`  New category [${existing.category}]: `) || existing.category;

  console.log(`\n  Current content:\n  ${dim(existing.content.slice(0, 200))}...\n`);
  const changeContent = await ask('  Change content? (yes/no): ');
  let content = existing.content;
  if (changeContent === 'yes') {
    console.log('  New content:');
    content = await askMultiline('') || existing.content;
  }

  const tagsRaw = await ask(`  New tags [${(existing.tags||[]).join(', ')}] (comma separated): `);
  const tags = tagsRaw ? tagsRaw.split(',').map(t=>t.trim()).filter(Boolean) : existing.tags;

  const spin = spinner('Saving...');
  const { error } = await supabase.from('knowledge').update({
    title, category, content, tags,
    updated_at: new Date().toISOString()
  }).eq('id', id);
  spin.stop();

  if (error) { console.log(red('  Error: ' + error.message)); return; }
  console.log(green('  ✓ Updated!'));
}

// STATS
async function cmdStats() {
  printHeader();
  const spin = spinner('Computing stats...');

  const { data, error } = await supabase.from('knowledge').select('*');
  spin.stop();

  if (error) { console.log(red('  Error: ' + error.message)); return; }

  const totalChars = data.reduce((s, k) => s + k.content.length, 0);
  const cats = {};
  const types = {};
  data.forEach(k => {
    cats[k.category] = (cats[k.category] || 0) + 1;
    if (k.file_type) types[k.file_type] = (types[k.file_type] || 0) + 1;
  });

  console.log(bold('  ∎ Knowledge Base Stats\n'));
  console.log(`  Total Items:      ${bold(data.length)}`);
  console.log(`  Total Characters: ${bold(totalChars.toLocaleString())}`);
  console.log(`  Avg Length:       ${bold(Math.round(totalChars / Math.max(data.length, 1)).toLocaleString())} chars`);
  console.log(`  Categories:       ${bold(Object.keys(cats).length)}`);

  console.log('\n  By Category:');
  Object.entries(cats).sort((a,b)=>b[1]-a[1]).forEach(([cat, count]) => {
    const bar = '█'.repeat(Math.min(Math.round(count/data.length*20), 20));
    console.log(`    ${cat.padEnd(16)} ${cyan(bar)} ${count}`);
  });

  if (Object.keys(types).length) {
    console.log('\n  By File Type:');
    Object.entries(types).sort((a,b)=>b[1]-a[1]).forEach(([t, c]) => {
      console.log(`    .${t.padEnd(10)} ${c} item(s)`);
    });
  }

  if (data.length) {
    console.log('\n  Recent Items:');
    data.slice(0, 5).forEach(k => {
      console.log(`    ${dim(new Date(k.created_at).toLocaleDateString('id-ID'))} ${bold(k.title.slice(0, 50))}`);
    });
  }
  console.log();
}

// EXPORT
async function cmdExport(args) {
  const outputPath = args[0] || `./knowledge-export-${Date.now()}.json`;
  
  printHeader();
  const spin = spinner('Exporting...');
  const { data, error } = await supabase.from('knowledge').select('*').order('created_at', { ascending: true });
  spin.stop();

  if (error) { console.log(red('  Error: ' + error.message)); return; }

  const out = JSON.stringify({ exported: new Date().toISOString(), total: data.length, items: data }, null, 2);
  fs.writeFileSync(outputPath, out);
  console.log(green(`  ✓ Exported ${data.length} items to: ${outputPath}`));
}

// IMPORT
async function cmdImport(args) {
  const filePath = args[0];
  if (!filePath) { console.log(red('  Usage: node cli/know.js import <backup.json>')); return; }

  if (!fs.existsSync(filePath)) { console.log(red('  File not found: ' + filePath)); return; }

  printHeader();
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const items = raw.items || raw;
  
  if (!Array.isArray(items)) { console.log(red('  Invalid format. Expected array of items.')); return; }
  
  console.log(bold(`  Found ${items.length} items to import\n`));
  const confirm = await ask('  Import all? (yes/no): ');
  if (confirm !== 'yes') { console.log(yellow('  Cancelled.')); return; }

  let ok = 0, fail = 0;
  const spin = spinner('Importing...');

  for (const item of items) {
    const { id: _, created_at, updated_at, ...rest } = item;
    const { error } = await supabase.from('knowledge').insert([rest]);
    if (error) fail++;
    else ok++;
  }

  spin.stop(green(`  ✓ Imported: ${ok} OK, ${fail} failed`));
}

// TAGS
async function cmdTags(args) {
  const id = args[0];
  const tags = args.slice(1).join(' ').split(',').map(t => t.trim()).filter(Boolean);
  if (!id) { console.log(red('  Usage: node cli/know.js tags <id> tag1,tag2,tag3')); return; }

  const { error } = await supabase.from('knowledge').update({ tags }).eq('id', id);
  if (error) { console.log(red('  Error: ' + error.message)); return; }
  console.log(green('  ✓ Tags updated: ' + tags.join(', ')));
}

// CLEAR ALL
async function cmdClearAll() {
  printHeader();
  console.log(red(bold('  ⚠ WARNING: This will delete ALL knowledge permanently!\n')));
  const confirm1 = await ask('  Type "DELETE ALL" to confirm: ');
  if (confirm1 !== 'DELETE ALL') { console.log(yellow('  Cancelled.')); return; }

  const spin = spinner('Deleting...');
  const { error } = await supabase.from('knowledge').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  spin.stop();
  if (error) { console.log(red('  Error: ' + error.message)); return; }
  console.log(green('  ✓ All knowledge deleted.'));
}

// HELP
function cmdHelp() {
  printHeader();
  console.log(bold('  Commands:\n'));
  const cmds = [
    ['list [category]',           'List all knowledge, optionally filter by category'],
    ['add',                       'Add knowledge interactively'],
    ['upload <path> [opts]',      'Upload file or folder to knowledge base'],
    ['  --category=name',         'Set category (default: file-upload)'],
    ['  --recursive / -r',        'Include subfolders'],
    ['search <query>',            'Full-text search in knowledge'],
    ['delete <id>',               'Delete knowledge by ID'],
    ['edit <id>',                 'Edit knowledge interactively'],
    ['tags <id> tag1,tag2',       'Set tags on knowledge'],
    ['stats',                     'Show knowledge base statistics'],
    ['export [output.json]',      'Export all knowledge to JSON'],
    ['import <backup.json>',      'Import knowledge from JSON backup'],
    ['clear-all',                 'Delete ALL knowledge (irreversible)'],
    ['help',                      'Show this help'],
  ];
  cmds.forEach(([cmd, desc]) => {
    console.log(`  ${cyan(cmd.padEnd(30))} ${dim(desc)}`);
  });

  console.log('\n' + bold('  Supported File Types:\n'));
  console.log(`  ${dim('Text/Code:')} .txt .md .log .js .ts .py .java .go .rs .php .html .css .json .yaml .sql ...`);
  console.log(`  ${dim('Documents:')} .pdf .docx .doc .epub .odt`);
  console.log(`  ${dim('Data:     ')} .csv .tsv .jsonl`);
  console.log(`  ${dim('Images:   ')} .jpg .png .gif .webp .svg (metadata only)`);

  console.log('\n' + bold('  Examples:\n'));
  console.log(`  ${yellow('node cli/know.js upload ~/Downloads/notes.pdf')}`);
  console.log(`  ${yellow('node cli/know.js upload ~/Documents/ --recursive --category=work')}`);
  console.log(`  ${yellow('node cli/know.js search "machine learning"')}`);
  console.log(`  ${yellow('node cli/know.js list tech')}`);
  console.log(`  ${yellow('node cli/know.js stats')}\n`);
}

// ══════════════════════════════════════
// MAIN
// ══════════════════════════════════════
async function main() {
  const [,, cmd, ...args] = process.argv;

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
    console.log(red('\n  Error: Missing SUPABASE_URL or SUPABASE_KEY in .env\n'));
    process.exit(1);
  }

  try {
    switch (cmd) {
      case 'list':       await cmdList(args); break;
      case 'add':        await cmdAdd(); break;
      case 'upload':     await cmdUpload(args); break;
      case 'search':     await cmdSearch(args); break;
      case 'delete':     await cmdDelete(args); break;
      case 'edit':       await cmdEdit(args); break;
      case 'stats':      await cmdStats(); break;
      case 'export':     await cmdExport(args); break;
      case 'import':     await cmdImport(args); break;
      case 'tags':       await cmdTags(args); break;
      case 'clear-all':  await cmdClearAll(); break;
      case 'help':
      case '--help':
      case '-h':
      case undefined:    cmdHelp(); break;
      default:
        console.log(red(`\n  Unknown command: ${cmd}\n`));
        cmdHelp();
    }
  } catch (e) {
    console.log(red('\n  Fatal Error: ' + e.message + '\n'));
    if (process.env.DEBUG) console.error(e);
  }
  process.exit(0);
}

main();
