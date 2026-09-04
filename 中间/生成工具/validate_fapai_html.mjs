#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const htmlDir = path.resolve(process.argv[2] || 'E:/dsh/产物/html');
const expected = new Map([
  ['泉州房源上新.html', [16]],
  ['福州房源上新.html', [16]],
  ['泉州法拍结果.html', [9, 14]],
  ['福州法拍结果.html', [9, 14]],
]);

const failures = [];
const failureSet = new Set();
const pass = [];
const count = (text, regex) => [...text.matchAll(regex)].length;

function fail(file, message) {
  const item = `${file}: ${message}`;
  if (!failureSet.has(item)) {
    failureSet.add(item);
    failures.push(item);
  }
}

for (const [file, expectedColumns] of expected) {
  const filePath = path.join(htmlDir, file);
  if (!fs.existsSync(filePath)) {
    fail(file, '文件不存在');
    continue;
  }

  const bytes = fs.readFileSync(filePath);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    fail(file, '禁止UTF-8 BOM');
  }

  let html;
  try {
    html = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    fail(file, '不是严格有效的UTF-8');
    continue;
  }

  const head = html.slice(0, 2048);
  const charsetCount = count(html, /<meta\b[^>]*charset\s*=\s*["']?utf-8["']?[^>]*>/gi);
  if (charsetCount !== 1) fail(file, `UTF-8 charset声明数量应为1，实际为${charsetCount}`);
  if (!/<head\b[^>]*>[\s\S]*?<meta\b[^>]*charset\s*=\s*["']?utf-8/i.test(head)) {
    fail(file, 'UTF-8 charset声明未位于head前部');
  }

  const mojibake = html.match(/�|锟斤拷|锟|ï»¿|Ã.|Â./g);
  if (mojibake) fail(file, `发现疑似乱码特征${mojibake.length}处`);

  for (const tag of ['table', 'thead', 'tbody', 'tr', 'th', 'td']) {
    const opens = count(html, new RegExp(`<${tag}\\b`, 'gi'));
    const closes = count(html, new RegExp(`</${tag}>`, 'gi'));
    if (opens !== closes) fail(file, `${tag}标签未闭合：开始${opens}，结束${closes}`);
  }

  const tables = [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)].map((match) => match[0]);
  if (tables.length !== expectedColumns.length) {
    fail(file, `表格数量应为${expectedColumns.length}，实际为${tables.length}`);
  }

  const actualHeaders = [];
  for (const [index, table] of tables.entries()) {
    if (count(table, /<thead\b/gi) !== 1 || count(table, /<\/thead>/gi) !== 1) {
      fail(file, `第${index + 1}个表格thead数量异常`);
    }
    if (count(table, /<tbody\b/gi) !== 1 || count(table, /<\/tbody>/gi) !== 1) {
      fail(file, `第${index + 1}个表格tbody数量异常`);
    }
    if (/<tbody\b[^>]*>[\s\S]*?<tbody\b/i.test(table)) {
      fail(file, `第${index + 1}个表格存在嵌套tbody`);
    }

    const header = table.match(/<thead\b[^>]*>[\s\S]*?<\/thead>/i)?.[0] || '';
    const columns = count(header, /<th\b/gi);
    actualHeaders.push(columns);

    let badDataRows = 0;
    let badDayRows = 0;
    for (const row of table.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi)) {
      const attrs = row[1];
      const inner = row[2];
      if (/<th\b/i.test(inner)) continue;
      const tdCount = count(inner, /<td\b/gi);
      if (/\bday-sep\b/i.test(attrs)) {
        const colspan = Number(inner.match(/<td\b[^>]*colspan\s*=\s*["']?(\d+)/i)?.[1]);
        if (tdCount !== 1 || colspan !== columns) {
          badDayRows += 1;
        }
      } else if (tdCount > 0 && tdCount !== columns) {
        badDataRows += 1;
      }
    }
    if (badDayRows) fail(file, `第${index + 1}个表格有${badDayRows}个日期分隔行的colspan与${columns}列不一致`);
    if (badDataRows) fail(file, `第${index + 1}个表格有${badDataRows}个数据行不是${columns}列`);
  }

  const sortedActual = actualHeaders.sort((a, b) => a - b);
  const sortedExpected = [...expectedColumns].sort((a, b) => a - b);
  if (JSON.stringify(sortedActual) !== JSON.stringify(sortedExpected)) {
    fail(file, `表头列数应为${sortedExpected.join('/')}，实际为${sortedActual.join('/') || '无'}`);
  }

  if (!failures.some((item) => item.startsWith(`${file}:`))) pass.push(file);
}

for (const file of pass) console.log(`PASS  ${file}`);
for (const message of failures) console.error(`FAIL  ${message}`);
console.log(`SUMMARY pass=${pass.length} fail=${failures.length}`);
process.exitCode = failures.length ? 1 : 0;
