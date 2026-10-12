// Chrome native messaging: when the extension calls connectNative, Chrome
// starts this program and talks to it over stdin/stdout. Each message is
// JSON preceded by its length as a 32-bit little-endian number. stdout
// belongs to Chrome, so nothing else may be printed there.

export function encode(msg) {
  const body = Buffer.from(JSON.stringify(msg), 'utf8');
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  return Buffer.concat([head, body]);
}

// Splits a byte stream into messages, keeping any partial message for later.
export function decoder(onMessage) {
  let buffered = Buffer.alloc(0);
  return (chunk) => {
    buffered = Buffer.concat([buffered, chunk]);
    while (buffered.length >= 4) {
      const len = buffered.readUInt32LE(0);
      if (buffered.length < 4 + len) break;
      const body = buffered.subarray(4, 4 + len);
      buffered = buffered.subarray(4 + len);
      try {
        onMessage(JSON.parse(body.toString('utf8')));
      } catch {
        // ignore a malformed message rather than crash
      }
    }
  };
}

// Chrome closes stdin when the extension disconnects; that's the signal to quit.
export function startNative({ stdin = process.stdin, stdout = process.stdout, onMessage = () => {}, onClose = () => {} } = {}) {
  stdin.on('data', decoder(onMessage));
  stdin.on('end', onClose);
  stdin.on('close', onClose);
  return { send: (msg) => stdout.write(encode(msg)) };
}
