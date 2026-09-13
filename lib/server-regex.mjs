import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

// Keep user-supplied regular expressions off the HTTP event loop. Pattern
// heuristics cannot reliably identify every exponential or polynomial case.
if (!isMainThread && workerData?.docviewRegex) {
  const regex = new RegExp(workerData.pattern, 'i');
  parentPort.on('message', ({ lines, limit }) => {
    const matches = [];
    for (let i = 0; i < lines.length && matches.length < limit; i++) {
      if (regex.test(lines[i])) matches.push(i);
    }
    parentPort.postMessage(matches);
  });
}

export function createRegexSearch(pattern, timeoutMs = 1000) {
  const worker = new Worker(new URL(import.meta.url), {
    workerData: { docviewRegex: true, pattern },
  });
  let pending;
  function finish(error, matches) {
    if (!pending) return;
    const { resolve, reject, timer } = pending;
    pending = undefined;
    clearTimeout(timer);
    if (error) reject(Object.assign(error, { regexSearch: true }));
    else resolve(matches);
  }
  worker.on('message', (matches) => finish(null, matches));
  worker.on('error', (error) => finish(error));
  worker.on('exit', () => finish(new Error('Regex search worker stopped')));

  return {
    findMatches(lines, limit) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          finish(Object.assign(new Error('Regex search took too long'), { status: 400 }));
          void worker.terminate();
        }, timeoutMs);
        pending = { resolve, reject, timer };
        worker.postMessage({ lines, limit });
      });
    },
    close() { return worker.terminate(); },
  };
}
