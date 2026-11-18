const byId = id => document.getElementById(id);
const context = byId("screen").getContext("2d");
let stream;
let pace = "normal";
let decoding = false;
let endpoint;
let view = 0;
let archiveSignature = "";
const params = new URL(location.href).searchParams;
const number = new Intl.NumberFormat();

function status(label, online = false) {
  const indicator = byId("connection");
  indicator.dataset.online = online;
  indicator.lastChild.textContent = ` ${label}`;
}

function connect(address) {
  const url = new URL(address, location.href);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Enter an HTTP or HTTPS server address without credentials.");
  }
  endpoint = url.origin;
  view++;
  byId("return-live").hidden = true;
  byId("endpoint").value = endpoint;
  stream?.close();
  const source = new EventSource(`${endpoint}/api/live?pace=${pace}`);
  stream = source;
  status("Connecting");
  byId("screen-message").hidden = false;
  byId("screen-message").textContent = "Waiting for the trainer";
  source.onmessage = event => show(JSON.parse(event.data), source);
  source.onerror = () => {
    status("Disconnected");
    byId("screen-message").hidden = false;
    byId("screen-message").textContent = "Waiting to reconnect. Check the trainer server address.";
  };
  source.addEventListener("failure", event => {
    source.close();
    status("Trainer stopped");
    byId("screen-message").hidden = false;
    byId("screen-message").textContent = JSON.parse(event.data);
  });
}

async function decodeFrame(frame) {
  const packed = Uint8Array.from(atob(frame), byte => byte.charCodeAt(0));
  const body = new Blob([packed]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new ImageData(new Uint8ClampedArray(await new Response(body).arrayBuffer()), 160, 144);
}

function showAction(action) {
  byId("action").textContent = action;
  byId("left").classList.toggle("active", action === "Left");
  byId("right").classList.toggle("active", action === "Right");
}

async function show(state, source) {
  if (decoding || source !== stream) return;
  decoding = true;
  try {
    const image = await decodeFrame(state.frame);
    if (source !== stream || source.readyState !== EventSource.OPEN) return;
    context.putImageData(image, 0, 0);
  } catch {
    status("Frame unavailable");
    return;
  } finally {
    decoding = false;
  }

  status("Connected", true);
  byId("screen-message").hidden = true;
  for (const key of ["generation", "total", "hp", "radness", "wipeouts"]) byId(key).textContent = number.format(state[key]);
  byId("speed").textContent = state.speed.toFixed(2);
  byId("high-score").textContent = number.format(state.highScore || 0);
  renderRecords(state.records || []);
  const progress = Math.floor(state.progress * 100);
  byId("progress").value = progress;
  byId("progress-value").textContent = `${progress}%`;
  byId("phase").textContent = state.evaluating ? `${state.phase} · Evaluating policy` :
    `${state.phase} · Policy ${state.policy} of ${state.population}`;
  showAction(state.action);
  byId("clips").hidden = !state.clips.length;
  document.querySelectorAll("[data-clip]").forEach(button => { button.hidden = !state.clips.includes(button.dataset.clip); });
  if (state.history.length) drawHistory(state.history);
  if (state.lastRound) {
    const last = byId("last-round");
    last.hidden = false;
    last.textContent = state.lastRound.finished ? `Last round · ${number.format(state.lastRound.score)} points` :
      `Last round · Ran out of HP at ${Math.floor(state.lastRound.progress * 100)}%`;
  }
}

function renderRecords(records) {
  const signature = records.map(record => `${record.id}:${record.score}`).join("|");
  if (signature === archiveSignature) return;
  archiveSignature = signature;
  const list = byId("record-list");
  list.replaceChildren();
  byId("record-empty").hidden = records.length > 0;
  for (const record of records) {
    const row = document.createElement("div");
    row.className = "record-row";
    const info = document.createElement("span");
    info.textContent = `${number.format(record.score)} points · Gen ${record.generation} · Round ${number.format(record.total)}`;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Watch";
    button.setAttribute("aria-label", `Watch record of ${number.format(record.score)} points`);
    button.addEventListener("click", () => {
      const id = String(record.id);
      if (!/^[1-9][0-9]{0,14}$/.test(id)) return;
      const url = `${endpoint}/api/records/${id}`;
      const video = byId("record-video");
      video.hidden = false;
      video.src = url;
      video.load();
      video.play().catch(() => {});
      const download = byId("record-download");
      download.hidden = false;
      download.href = url;
      download.download = `pikachus-beach-${record.score}-points.webm`;
      download.textContent = `Download ${number.format(record.score)}-point recording`;
    });
    row.append(info, button);
    list.append(row);
  }
}

async function playClip(button) {
  const currentView = ++view;
  stream?.close();
  byId("return-live").hidden = false;
  status("Recorded attempt");
  byId("screen-message").hidden = true;
  try {
    const response = await fetch(`${endpoint}/api/clips/${button.dataset.clip}`);
    if (!response.ok) throw new Error("Clip unavailable");
    const clip = await response.json();
    if (currentView !== view) return;
    byId("phase").textContent = clip.finished ? `${button.textContent} · ${number.format(clip.score)} points` :
      `${button.textContent} · Ran out of HP`;
    const started = performance.now();
    for (const [index, frame] of clip.frames.entries()) {
      const wait = started + index * 1000 / 12 - performance.now();
      if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
      if (currentView !== view) return;
      const image = await decodeFrame(frame.frame);
      if (currentView !== view) return;
      context.putImageData(image, 0, 0);
      showAction(frame.action);
    }
  } catch {
    if (currentView !== view) return;
    byId("screen-message").hidden = false;
    byId("screen-message").textContent = "The clip is unavailable.";
  }
}

function drawHistory(history) {
  const latest = history.at(-1);
  byId("evaluation").textContent = `${Math.round(latest.finishRate * 100)}% finished · ${number.format(latest.averageScore)} average points · ${latest.averageWipeouts.toFixed(1)} wipeouts per run`;
  const trend = byId("trend");
  trend.hidden = false;
  const draw = trend.getContext("2d");
  draw.clearRect(0, 0, trend.width, trend.height);
  const scale = Math.max(1, ...history.map(row => row.averageScore));
  const width = trend.width / history.length;
  draw.fillStyle = "#f1df79";
  history.forEach((row, index) => {
    const height = Math.max(2, row.averageScore / scale * trend.height);
    draw.fillRect(index * width, trend.height - height, Math.max(1, width - 2), height);
  });
}

document.querySelectorAll("[data-pace]").forEach(button => {
  button.addEventListener("click", () => {
    if (pace === button.dataset.pace) return;
    pace = button.dataset.pace;
    document.querySelectorAll("[data-pace]").forEach(choice => choice.setAttribute("aria-pressed", choice === button));
    if (endpoint) connect(endpoint);
  });
});
document.querySelectorAll("[data-clip]").forEach(button => button.addEventListener("click", () => playClip(button)));
byId("return-live").addEventListener("click", () => connect(endpoint));
byId("server-form").addEventListener("submit", event => {
  event.preventDefault();
  try {
    connect(byId("endpoint").value);
    const url = new URL(location.href);
    url.searchParams.set("server", endpoint);
    history.replaceState(null, "", url);
    byId("address-error").textContent = "";
  } catch (error) {
    byId("address-error").textContent = error.message;
  }
});
try {
  if (params.has("server") || ["/", "/index.html"].includes(location.pathname)) connect(params.get("server") || location.origin);
  else {
    status("Server address needed");
    byId("settings").open = true;
    byId("screen-message").textContent = "Enter the trainer server address below.";
  }
} catch (error) {
  byId("settings").open = true;
  byId("address-error").textContent = error.message;
}
