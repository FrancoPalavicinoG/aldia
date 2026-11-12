import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter } from '../src/frontmatter.js';

test('plain and quoted values', () => {
  const text = ['---', 'name: reviewer', 'description: "Use: when reviewing code"', "license: 'MIT'", '---', '# Body'].join('\n');
  assert.deepEqual(parseFrontmatter(text), {
    name: 'reviewer',
    description: 'Use: when reviewing code',
    license: 'MIT',
  });
});

test('folded (>-) values join lines with spaces', () => {
  const text = ['---', 'name: court', 'description: >-', '  Put an idea on trial', '  in front of a jury.', 'version: 1', '---'].join('\n');
  assert.deepEqual(parseFrontmatter(text), {
    name: 'court',
    description: 'Put an idea on trial in front of a jury.',
    version: '1',
  });
});

test('literal (|) values keep their line breaks', () => {
  const text = ['---', 'description: |', '  First line', '  Second line', '---'].join('\n');
  assert.deepEqual(parseFrontmatter(text), { description: 'First line\nSecond line' });
});

test('lists and nested keys are skipped, not mistaken for values', () => {
  const text = ['---', 'name: tool', 'allowed-tools:', '  - Bash(node *)', '  - Read', 'description: Does things', '---'].join('\n');
  assert.deepEqual(parseFrontmatter(text), { name: 'tool', description: 'Does things' });
});

test('Windows line endings are handled', () => {
  assert.deepEqual(parseFrontmatter('---\r\nname: win\r\n---\r\nbody'), { name: 'win' });
});

test('a file without frontmatter gives null', () => {
  assert.equal(parseFrontmatter('# Just a heading\n'), null);
  assert.equal(parseFrontmatter('---\nname: never closed\n'), null);
});
