// Loads the packed daily data once and scores hexes on request, off the main thread.
import { dayMonths, score } from "./score.js";

let data, meta, months;

const ready = (async () => {
  meta = await (await fetch("../data/meta.json")).json();
  const res = await fetch("../data/days.bin");
  if (!res.ok) throw new Error(`days.bin: HTTP ${res.status}`);

  const total = meta.hexes * meta.days * meta.planes.length;
  data = new Uint8Array(total);
  let loaded = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    data.set(value, loaded);
    loaded += value.length;
    postMessage({ type: "progress", loaded, total });
  }
  if (loaded !== total) throw new Error(`days.bin: expected ${total} bytes, got ${loaded}`);

  months = dayMonths(meta);
  postMessage({ type: "ready", meta });
})().catch(err => {
  data = null;
  postMessage({ type: "error", message: err.message });
});

onmessage = async e => {
  await ready;
  if (!data) return;
  const result = score(data, meta, months, e.data);
  postMessage({ type: "result", ...result }, [result.perfect.buffer]);
};
