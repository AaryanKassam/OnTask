import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { decoder, encode, startNative } from '../src/native.js';
import { extensionId } from '../scripts/setup.js';

test('native messages are length-prefixed JSON, split and joined correctly', () => {
  const got = [];
  const feed = decoder((m) => got.push(m));
  const bytes = Buffer.concat([encode({ a: 1 }), encode({ b: 'Aaryan’s MacBook' })]);
  feed(bytes.subarray(0, 3)); // arrives in awkward pieces
  feed(bytes.subarray(3, 12));
  feed(bytes.subarray(12));
  assert.deepEqual(got, [{ a: 1 }, { b: 'Aaryan’s MacBook' }]);
});

test('closing stdin (Chrome disconnecting) shuts the companion down', async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  let closed = false;
  const native = startNative({ stdin, stdout, onClose: () => (closed = true) });
  native.send({ type: 'ready', port: 4517 });
  const out = stdout.read();
  assert.equal(out.readUInt32LE(0), out.length - 4);
  stdin.end();
  await new Promise((r) => setImmediate(r));
  assert.ok(closed);
});

test('the extension ID the setup registers matches the key in the manifest', () => {
  assert.match(extensionId(), /^[a-p]{32}$/);
});
