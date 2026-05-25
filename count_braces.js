const fs = require('fs');
const content = fs.readFileSync('c:/Users/andre/ADU_Rent_Calculator/src/App.jsx', 'utf8');
const lines = content.split('\n');
let depth = 0;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  let inStr = false;
  let strChar = '';
  for (let j = 0; j < line.length; j++) {
    const c = line[j];
    if (inStr) {
      if (c === strChar && line[j-1] !== '\\') inStr = false;
    } else {
      if (c === '"' || c === "'" || c === '`') { inStr = true; strChar = c; }
      else if (c === '{') depth++;
      else if (c === '}') depth--;
    }
  }
  if (i === lines.length - 1) console.log('Final depth:', depth, 'at line', i+1);
  if (depth <= 1 && i > 10) console.log('Depth ' + depth + ' at line ' + (i+1) + ': ' + line.trim().substring(0, 80));
}
