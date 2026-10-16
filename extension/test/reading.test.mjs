// Going still on a page: reading, doing questions, or actually idle.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installChrome } from './chrome-mock.mjs';

const MIN = 60_000;
const sentence = 'The city council met on Tuesday to discuss the new budget for parks and libraries across the region.';
const article = { lines: Array.from({ length: 16 }, () => sentence), totalWords: 2400 };
const textbook = {
  lines: [
    'CHAPTER 4 · EIGENVALUES AND EIGENVECTORS',
    '4.3 Diagonalization',
    'Theorem 4.3.1. An n x n matrix A is diagonalizable if and only if A has n linearly independent eigenvectors.',
    'Exercises 4.3',
    '1. Determine whether the matrix A is diagonalizable. Justify your answer.',
    '2. Find an invertible matrix P and a diagonal matrix D such that P^-1 A P = D.',
  ],
  totalWords: 900,
};

const t = installChrome({ tabs: [{ id: 1, url: 'https://news.example.com/budget', title: 'Council budget explained', page: article }] });
await import('../background.js');
chrome.runtime.onInstalled.fire();
await t.settle(60);
await t.answer('ask-set', 'Linear algebra');

test('Chrome is asked to report stillness after one minute', () => {
  assert.equal(t.idleInterval, 60);
});

test('still on a page full of text: asks “Reading?”, quietly', async () => {
  const chimes = t.chimes;
  t.now += 2 * MIN;
  await t.idle('idle');
  const card = t.lastCard();
  assert.equal(card.kind, 'reading');
  assert.ok(card.words >= 250 && card.totalWords === 2400);
  assert.equal(t.chimes, chimes, 'no sound');
  assert.ok(t.state().current, 'the clock keeps running while it asks');
});

test('“Yes, reading” keeps the clock running for the reading time, then checks in', async () => {
  await t.answer('study-yes');
  const s = t.state();
  assert.equal(s.current.verdict, 'on');
  assert.equal(s.current.reason, 'Reading');
  assert.equal(t.alarms['idle-check'], s.study.until);
  assert.ok(s.study.until - t.now >= 3 * MIN);
  const chimes = t.chimes;
  await t.advanceTo('idle-check');
  assert.equal(t.lastCard().kind, 'idle', 'still idle after the reading time: “Still with it?”');
  assert.equal(t.chimes, chimes + 1, 'that one chimes');
  assert.equal(t.state().current, null, 'and the clock stops');
});

test('a textbook page with exercises asks about doing the questions, until the block ends', async () => {
  await t.idle('active');
  t.now += 1000;
  await t.visit(2, 'https://textbook.example.com/ch4', 'Linear Algebra, Chapter 4', { page: textbook });
  t.tabs.find((x) => x.id === 2).page = textbook;
  t.now += 2 * MIN;
  await t.idle('idle');
  assert.equal(t.lastCard().kind, 'questions');
  await t.answer('study-yes');
  const s = t.state();
  assert.equal(s.current.reason, 'Doing the questions');
  const blockEnd = s.timer.endsAt;
  assert.equal(s.study.until, Math.max(t.now + 10 * MIN, blockEnd));
});

test('saying No means it won’t ask again on that page', async () => {
  await t.idle('active');
  await t.visit(3, 'https://blog.example.com/post', 'A long blog post');
  t.tabs.find((x) => x.id === 3).page = article;
  await t.idle('idle');
  assert.equal(t.lastCard().kind, 'reading');
  await t.answer('study-no');
  await t.idle('active');
  const shown = t.injected.length;
  await t.idle('idle');
  assert.equal(t.injected.length, shown, 'no second prompt');
});

test('a page with little text: no question, just the usual idle check later', async () => {
  await t.idle('active');
  await t.visit(4, 'https://www.youtube.com/watch?v=lecture', 'Linear algebra lecture 4 - YouTube');
  t.tabs.find((x) => x.id === 4).page = { lines: ['Linear algebra lecture 4', '12K views'], totalWords: 6 };
  const shown = t.injected.length;
  await t.idle('idle');
  assert.equal(t.injected.length, shown);
  assert.equal(t.alarms['idle-check'], t.state().stillSince + 5 * MIN);
});

test('a page the extension can’t read (a PDF) and no companion: falls back to the usual check', async () => {
  await t.idle('active');
  await t.visit(5, 'https://example.com/textbook.pdf', 'textbook.pdf');
  t.tabs.find((x) => x.id === 5).unreadable = true;
  const shown = t.injected.length;
  await t.idle('idle');
  assert.equal(t.injected.length, shown);
});
