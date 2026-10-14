import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { csvCell, toCsv } from '../src/csv.js';

describe('the CSV export', () => {
  test('prefixes cells a spreadsheet would run as a formula', () => {
    assert.equal(csvCell('=HYPERLINK("http://evil.example","x")'), `"'=HYPERLINK(""http://evil.example"",""x"")"`);
    assert.equal(csvCell('+1+1'), "'+1+1");
    assert.equal(csvCell('-2+3'), "'-2+3");
    assert.equal(csvCell('@SUM(A1)'), "'@SUM(A1)");
    assert.equal(csvCell('\tcmd'), "'\tcmd");
    assert.equal(csvCell('\r=1'), `"'\r=1"`);
  });

  test('leaves ordinary values alone and quotes commas, quotes and line breaks', () => {
    assert.equal(csvCell('grower@example.org'), 'grower@example.org');
    assert.equal(csvCell("o'neil@shop.example"), "o'neil@shop.example");
    assert.equal(csvCell('a, b'), '"a, b"');
    assert.equal(csvCell('say "hi"'), '"say ""hi"""');
    assert.equal(csvCell('two\nlines'), '"two\nlines"');
    assert.equal(csvCell(7), '7');
    assert.equal(csvCell(null), '');
    assert.equal(csvCell(undefined), '');
  });

  test('writes a header row and CRLF line endings', () => {
    const csv = toCsv(
      [
        { email: 'a@example.org', name: '=cmd', price: 7 },
        { email: 'b@example.org', name: null, price: 4 },
      ],
      ['email', 'name', 'price'],
    );
    assert.equal(csv, "email,name,price\r\na@example.org,'=cmd,7\r\nb@example.org,,4\r\n");
  });
});
