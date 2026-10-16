// Reads the text in an image with Apple's Vision framework, on this Mac.
// Runs with the JavaScript for Automation that ships with macOS, so nothing
// needs compiling:  osascript -l JavaScript ocr.js <image>
// Prints JSON: {"lines":[{"text":…,"height":…,"y":…}]}, where height and y
// are fractions of the image height (y measured from the top).

ObjC.import('Foundation');
ObjC.import('Vision');

function run(argv) {
  const url = $.NSURL.fileURLWithPath(argv[0]);
  const request = $.VNRecognizeTextRequest.alloc.init;
  request.recognitionLevel = 0; // accurate
  request.usesLanguageCorrection = false;
  const handler = $.VNImageRequestHandler.alloc.initWithURLOptions(url, $({}));
  if (!handler.performRequestsError($([request]), null)) return JSON.stringify({ error: 'text recognition failed' });
  const results = request.results;
  const lines = [];
  for (let i = 0; i < results.count; i++) {
    const observation = results.objectAtIndex(i);
    const best = observation.topCandidates(1).firstObject;
    if (!best || best.confidence < 0.3) continue;
    const box = observation.boundingBox;
    lines.push({ text: best.string.js, height: box.size.height, y: 1 - (box.origin.y + box.size.height) });
  }
  return JSON.stringify({ lines });
}
