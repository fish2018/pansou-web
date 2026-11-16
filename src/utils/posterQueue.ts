interface PosterTask {
  signal: AbortSignal;
  started: boolean;
  run: () => Promise<void>;
  cancel: () => void;
}

const MAX_ACTIVE_POSTERS = 2;
const pending: PosterTask[] = [];
let active = 0;
let drainScheduled = false;

const abortError = () => new DOMException('Poster request cancelled', 'AbortError');

const scheduleDrain = () => {
  if (drainScheduled) return;
  drainScheduled = true;
  // Batch visibility callbacks before starting replacements for cancelled images.
  setTimeout(() => { drainScheduled = false; drain(); }, 0);
};

const drain = () => {
  while (active < MAX_ACTIVE_POSTERS && pending.length) {
    const task = pending.shift()!;
    if (task.signal.aborted) { task.cancel(); continue; }
    task.started = true;
    active++;
    // An aborted request keeps its slot until the actual transport settles.
    void task.run().finally(() => { active--; scheduleDrain(); });
  }
};

export const queuePosterRequest = <T>(signal: AbortSignal, request: () => Promise<T>): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    if (signal.aborted) { reject(abortError()); return; }
    const task: PosterTask = {
      signal,
      started: false,
      run: async () => {
        try {
          if (signal.aborted) throw abortError();
          resolve(await request());
        } catch (error) { reject(error); }
        finally { signal.removeEventListener('abort', task.cancel); }
      },
      cancel: () => {
        if (task.started) return;
        const index = pending.indexOf(task);
        if (index !== -1) pending.splice(index, 1);
        signal.removeEventListener('abort', task.cancel);
        reject(abortError());
      }
    };
    signal.addEventListener('abort', task.cancel, { once: true });
    pending.push(task);
    scheduleDrain();
  });
