const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const files = process.argv.slice(2);
for (const f of files) {
  console.log('===', f, '===');
  if (!fs.existsSync(f)) {
    console.log('MISSING');
    continue;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kairos-docx-'));
  const zipCopy = path.join(tmp, 'doc.zip');
  fs.copyFileSync(f, zipCopy);
  execFileSync(
    'powershell',
    ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zipCopy}' -DestinationPath '${tmp}' -Force`],
    { stdio: 'pipe' },
  );
  const xmlPath = path.join(tmp, 'word', 'document.xml');
  const xml = fs.readFileSync(xmlPath, 'utf8');
  const text = xml
    .replace(/<w:tab[^/]*\/>/g, '\t')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
  console.log(text.slice(0, 15000));
  console.log('\n[chars]', text.length, '\n');
  fs.rmSync(tmp, { recursive: true, force: true });
}
