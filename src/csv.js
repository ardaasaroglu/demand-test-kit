// CSV for the waitlist export. Pure functions, unit tested in test/csv.test.mjs.

// A cell that starts with one of these is run as a formula by Excel, LibreOffice and Google
// Sheets ("CSV injection"). A leading apostrophe makes the spreadsheet show it as text.
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ?`"${text.replace(/"/g, '""')}"` : text;
}

/** rows: array of objects. columns: the keys to write, in order. Lines end with CRLF (RFC 4180). */
export function toCsv(rows, columns) {
  const lines = [columns.map(csvCell).join(',')];
  for (const row of rows) lines.push(columns.map((c) => csvCell(row[c])).join(','));
  return `${lines.join('\r\n')}\r\n`;
}
