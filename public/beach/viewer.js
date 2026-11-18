const byId = id => document.getElementById(id);
const context = byId("screen").getContext("2d");
let stream;
let pace = "normal";
let decoding = false;
let endpoint;
let view = 0;
let archiveSignature = "";
let milestoneSignature = "";
let generationArchive = [];
let selectedGeneration = "current";
let analyticsLastTotal = -1;
let analyticsLastGen = -1;
let analyticsLastRefresh = 0;
let analyticsLoading = false;
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
  archiveSignature = "";
  milestoneSignature = "";
  void fetch(`${endpoint}/api/milestones`, {cache:"no-store"})
    .then(response => response.ok ? response.json() : [])
    .then(rows => { if (endpoint === url.origin && Array.isArray(rows)) renderMilestones(rows); })
    .catch(() => {});
  void fetch(`${endpoint}/api/records`, { cache: "no-store" })
    .then(response => response.ok ? response.json() : [])
    .then(records => { if (endpoint === url.origin && Array.isArray(records)) renderRecords(records); })
    .catch(() => {});
  analyticsLastTotal = -1;
  analyticsLastGen = -1;
  void loadGenerations();
  void loadAnalytics();
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
  // The landing predictor is strictly for the agent, not a spectator metric.
  if (state.generation !== analyticsLastGen || (state.total !== analyticsLastTotal &&
      performance.now() - analyticsLastRefresh > 7000)) {
    if (state.generation !== analyticsLastGen) void loadGenerations();
    analyticsLastTotal = state.total;
    analyticsLastGen = state.generation;
    if (selectedGeneration === "current") void loadAnalytics();
  }

  renderRecords(state.records || []);
  renderMilestones(state.milestoneVideos || []);
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

function renderMilestones(rows) {
  const signature = rows.map(row => `${row.id}:${row.total}:${row.awards}`).join("|");
  if (signature === milestoneSignature) return;
  milestoneSignature = signature;
  const list = byId("milestone-list");
  list.replaceChildren();
  byId("milestone-empty").hidden = rows.length > 0;
  for (const entry of rows) {
    const id = String(entry.id);
    if (!/^[1-9][0-9]{0,14}$/.test(id)) continue;
    const row = document.createElement("div");
    row.className = "record-row";
    const description = document.createElement("span");
    const outcome = entry.finished ? `${number.format(entry.score)} final score` : "Run ended early";
    description.textContent = `${entry.awards} × +500 · Gen ${entry.generation} · Round ${number.format(entry.total)} · ${outcome} · ${entry.fullRun ? "Full run" : "Trick highlight"}`;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Watch";
    button.setAttribute("aria-label", `Watch verified 500-point trick from round ${entry.total}`);
    button.addEventListener("click", () => {
      const url = `${endpoint}/api/milestones/${id}`;
      const video = byId("milestone-video");
      video.hidden = false;
      video.src = url;
      video.load();
      video.play().catch(() => {});
      const download = byId("milestone-download");
      download.hidden = false;
      download.href = url;
      download.download = `pikachus-beach-500-trick-run-${entry.total}.webm`;
      download.textContent = `Download run ${number.format(entry.total)} recording`;
    });
    row.append(description, button);
    list.append(row);
  }
}

async function loadGenerations() {
  if (!endpoint) return;
  const origin = endpoint;
  try {
    const response = await fetch(`${origin}/api/generations`, { cache: "no-store" });
    if (!response.ok) throw new Error("Unable to load generation archive");
    const rows = await response.json();
    if (origin !== endpoint || !Array.isArray(rows)) return;
    generationArchive = rows;
    const picker = byId("generation-picker");
    const current = picker.value;
    picker.replaceChildren();
    const option = document.createElement("option");
    option.value = "current";
    option.textContent = "Current generation";
    picker.append(option);
    for (const entry of rows) {
      if (!Number.isSafeInteger(entry.generation)) continue;
      const item = document.createElement("option");
      item.value = String(entry.generation);
      item.textContent = `Generation ${entry.generation}${entry.complete ? "" : " (partial)"}`;
      picker.append(item);
    }
    if (current === "current" || rows.some(row => String(row.generation) === current)) {
      picker.value = current;
    } else {
      picker.value = "current";
      selectedGeneration = "current";
    }
  } catch (error) {
    byId("analytics-status").textContent = error.message;
  }
}

async function loadAnalytics() {
  if (!endpoint || analyticsLoading) return;
  analyticsLoading = true;
  analyticsLastRefresh = performance.now();
  const origin = endpoint;
  const selection = selectedGeneration;
  try {
    const url = selection === "current" ?
      `${origin}/api/generation/current` : `${origin}/api/generations/${selection}`;
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error("Generation telemetry temporarily unavailable");
    const result = await response.json();
    if (origin !== endpoint || selection !== selectedGeneration || !Array.isArray(result.runs)) return;
    renderAnalytics(result.summary, result.runs);
  } catch (error) {
    byId("analytics-status").textContent = error.message;
  } finally {
    analyticsLoading = false;
  }
}

function drawMetric(canvasId, runs, key, color) {
  const canvas = byId(canvasId);
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  const left = 41, top = 12, bottom = h - 24, right = w - 14;
  ctx.clearRect(0, 0, w, h);
  ctx.lineWidth = 1;
  ctx.font = "12px system-ui";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#a9c2bc";
  ctx.strokeStyle = "#365250";
  const maxValue = Math.max(1, ...runs.map(run => Number(run[key]) || 0));
  const ceiling = Math.ceil(maxValue / (maxValue > 100 ? 100 : maxValue > 10 ? 5 : 1)) *
    (maxValue > 100 ? 100 : maxValue > 10 ? 5 : 1);
  for (let i = 0; i <= 3; i++) {
    const y = top + (bottom - top) * i / 3;
    ctx.beginPath(); ctx.moveTo(left,y); ctx.lineTo(right,y); ctx.stroke();
    ctx.textAlign = "right";
    const label = ceiling * (3 - i) / 3;
    ctx.fillText(key === "averageSpeed" ? label.toFixed(1) : Math.round(label).toString(), left - 5, y);
  }
  if (!runs.length) {
    ctx.textAlign = "center";
    ctx.fillText("No runs recorded", (left + right) / 2, (top + bottom) / 2);
    return;
  }
  ctx.textAlign = "center";
  ctx.fillText("1",left,bottom+15);
  ctx.fillText(String(runs.length),right,bottom+15);
  const points = runs.map((run,i) => ({
    x: left + (runs.length === 1 ? .5 : i / (runs.length-1)) * (right-left),
    y: bottom - ((Number(run[key]) || 0) / ceiling) * (bottom - top),
  }));
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  points.forEach((p,i) => i ? ctx.lineTo(p.x,p.y) : ctx.moveTo(p.x,p.y));
  ctx.stroke();
  ctx.fillStyle = color;
  if (points.length <= 55) for (const p of points) {
    ctx.beginPath(); ctx.arc(p.x,p.y,2.4,0,Math.PI*2); ctx.fill();
  }
}

function renderAnalytics(summary, runs) {
  if (!summary) return;
  const format = n => number.format(Math.round(n || 0));
  byId("analytics-status").textContent = `Generation ${summary.generation} · ${summary.complete ? "Complete archive" : "Collecting / partial data"} · ${runs.length} recorded attempts`;
  byId("analytics-runs").textContent = format(runs.length);
  byId("analytics-finish").textContent = `${Math.round((summary.completionRate || 0) * 100)}%`;
  byId("analytics-best").textContent = format(summary.bestScore);
  const unclassified = byId("trick-unclassified");
  unclassified.hidden = !(summary.unclassifiedRadness > 0);
  unclassified.textContent = `${format(summary.unclassifiedRadness)} radness points not assigned to a specific trick reward (instrumentation reconciliation).`;
  const tricks = byId("trick-breakdown");
  tricks.replaceChildren();
  for (const award of [50,150,180,350,500]) {
    const cell = document.createElement("div");
    const numberElement = document.createElement("strong");
    numberElement.textContent = format(summary.tricks?.[award] || 0);
    const name = document.createElement("span");
    name.textContent = `+${award} tricks`;
    cell.append(numberElement, name);
    tricks.append(cell);
  }
  drawMetric("chart-score",runs,"score","#f1df79");
  drawMetric("chart-radness",runs,"radness","#8fe3be");
  drawMetric("chart-hp",runs,"hpRemaining","#a3c8ff");
  drawMetric("chart-speed",runs,"averageSpeed","#edac82");
}

byId("generation-picker").addEventListener("change", event => {
  selectedGeneration = event.target.value;
  void loadAnalytics();
});

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
