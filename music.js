// Connect Audio Studio's local music composer to Kaggle generation and playback.

(() => {
  const hosted = location.hostname === "vspace-agent.github.io";
  const apiBase = hosted
    ? "https://audio-studio-api-jwu3axpvwq-ey.a.run.app"
    : "";
  const api = (path) => apiBase + path;
  const form = document.querySelector("#music-form");
  const syncButton = document.querySelector("#music-sync");
  const syncStatus = document.querySelector("#music-sync-status");
  let syncTimer = null;

  async function refreshSync() {
    try {
      const response = await fetch(api("/api/music/sync-evaluation"));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const job = await response.json();
      syncButton.disabled = job.state === "running";
      syncStatus.textContent = job.error || job.message || "";
      if (job.state === "running" && syncTimer === null) {
        syncTimer = setInterval(refreshSync, 2500);
      } else if (job.state !== "running" && syncTimer !== null) {
        clearInterval(syncTimer);
        syncTimer = null;
      }
    } catch (error) {
      syncButton.disabled = false;
      syncStatus.textContent = `Sync status unavailable: ${error.message}`;
    }
  }

  if (hosted) {
    syncButton.disabled = true;
    syncStatus.textContent = "Cloud recordings are archived automatically.";
  }

  syncButton.addEventListener("click", async () => {
    syncButton.disabled = true;
    syncStatus.textContent = "Starting synchronization…";
    try {
      const response = await fetch(api("/api/music/sync-evaluation"), {method: "POST"});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await refreshSync();
    } catch (error) {
      syncButton.disabled = false;
      syncStatus.textContent = `Could not start sync: ${error.message}`;
    }
  });
  if (!hosted) refreshSync();

  const variations = document.querySelector("#music-variations");

  const route = document.querySelector("#music-route");
  let turboVariations = variations.value;

  function updateVariationMode() {
    if (route.value === "sft_lm") {
      if (!variations.disabled) turboVariations = variations.value;
      variations.value = "1";
      variations.disabled = true;
      variations.title = "SFT + LM generates one variation per composition.";
    } else {
      variations.disabled = false;
      variations.value = turboVariations;
      variations.title = "";
    }
  }

  variations.addEventListener("change", () => {
    if (route.value !== "sft_lm") turboVariations = variations.value;
  });
  route.addEventListener("change", updateVariationMode);
  updateVariationMode();

  const duration = document.querySelector("#music-duration");
  const button = document.querySelector("#music-generate");
  const status = document.querySelector("#music-status");

  let polling = null;
  let activeJob = null;

  function message(text) {
    status.textContent = text;
  }

  function stopPolling() {
    if (polling !== null) {
      clearInterval(polling);
      polling = null;
    }
  }


  function render(job) {
    const running = job.state === "running";
    button.disabled = running;
    button.textContent = running ? "Composing…" : "Generate batch";

    if (running) {
      const stages = {
        starting: "Preparing your composition",
        PACKAGE_READY: "Composition package prepared",
        SUBMITTING: "Sending composition to Kaggle",
        SUBMITTED: "Composition submitted to Kaggle",
        MONITORING: "Waiting for Kaggle execution updates",
        EXECUTION_FILES_STAGED: "Preparing files on Kaggle",
        EXECUTION_JOB_START: "Kaggle execution started",
        EXECUTION_ENVIRONMENT_PREPARATION: "Preparing the music generator",
        EXECUTION_GENERATOR_START: "Generating your music",
        EXECUTION_JOB_COMPLETE: "Music generation finished",
        DOWNLOADING_OUTPUT: "Downloading your music",
        OUTPUT_RETRIEVED: "Saving your music to the library",
        AUDIO_ARCHIVED: "Finalizing your composition",
        BATCH_ARCHIVED: "Finalizing your batch",
        PROMPT_ARCHIVED: "Saving completed compositions",
        PROMPT_RECORDED_FAILED: "Recording a failed composition",
      };
      const kaggleStatus = job.kaggle_status;
      const label = stages[job.stage] ||
        job.stage.replaceAll("_", " ").toLowerCase();
      const waiting = job.stage === "MONITORING" &&
        kaggleStatus && kaggleStatus !== "COMPLETE";
      const seconds = job.elapsed_seconds;
      const elapsed = Number.isFinite(seconds)
        ? ` · ${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s elapsed`
        : "";
      message((waiting
        ? `Waiting for Kaggle (${kaggleStatus})…`
        : `${label}…`) + elapsed);
    } else if (job.state === "complete") {
      message("Generation complete. Recordings are stored in the audio archive.");
      stopPolling();
    } else if (job.state === "error") {
      message(job.error || "The composition could not be completed.");
      stopPolling();
    } else {
      message("Composer ready.");
      stopPolling();
    }

    activeJob = running ? job.id : null;
  }

  async function requestJSON(url, options) {
    const response = await fetch(url, options);
    const data = await response.json();
    if (!response.ok) {
      throw new Error(typeof data.detail === "string" ? data.detail : `HTTP ${response.status}`);
    }
    return data;
  }

  async function refresh() {
    try {
      const job = await requestJSON(api("/api/music/status"));
      render(job);
    } catch (error) {
      stopPolling();
      button.disabled = true;
      message(`Composer unavailable: ${error.message}`);
    }
  }

  function startPolling() {
    stopPolling();
    polling = setInterval(refresh, 3000);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    let compositions;
    let batchTheme;
    try {
      const parsed = parseMusicBatchDocument(
        document.querySelector("#music-batch-document").value
      );
      compositions = parsed.compositions;
      batchTheme = parsed.batchTheme;
    } catch (error) {
      message(error.message);
      return;
    }

    button.disabled = true;
    message("Sending your composition to Kaggle…");

    try {
      const job = await requestJSON(
        api("/api/music/generate-batch"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompts: compositions,
            batch_theme: batchTheme,
            route: route.value,
            duration_seconds: Number(duration.value),
            variations: Number(variations.value),
          }),
        }
      );
      render(job);
      if (job.state === "running") startPolling();
    } catch (error) {
      message(`Could not start composition: ${error.message}`);
      await refresh();
      if (activeJob) startPolling();
    }
  });

  // Reconnect to an active job when the page is reopened.
  refresh().then(() => {
    if (activeJob) startPolling();
  });
})();


function parseMusicBatchDocument(text) {
  const entries = [];
  let current = null;
  let theme = null;

  for (const rawLine of text.replace(/\r\n?/g, "\n").replace(/\\\s*\n/g, "\n").split("\n")) {
    const line = rawLine.trim();
    const themeMatch = line.match(/^batch_theme:\s*(.+)$/i);
    const header = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*$/);

    if (themeMatch && !current) {
      if (theme !== null) {
        throw new Error("Batch theme may only appear once.");
      }
      theme = themeMatch[1].trim();
    } else if (header) {
      if (current) entries.push(current);
      current = { filename: header[1], lines: [] };
    } else if (current) {
      current.lines.push(rawLine);
    } else if (line) {
      throw new Error("Expected batch_theme: or a composition filename:");
    }
  }

  if (current) entries.push(current);

  if (!theme) {
    throw new Error("Missing batch_theme: at the beginning of the document.");
  }

  const batchTheme = theme
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "");

  if (!batchTheme || batchTheme.length > 60) {
    throw new Error("Invalid batch theme.");
  }

  if (!entries.length || entries.length > 20) {
    throw new Error("A batch must contain 1–20 compositions.");
  }

  const names = new Set();

  const compositions = entries.map((entry, index) => {
    const filename = entry.filename.toLowerCase();

    if (names.has(filename)) {
      throw new Error(`Duplicate filename: ${filename}`);
    }

    const prompt = entry.lines.join("\n").trim();

    if (!prompt) {
      throw new Error(`Missing description for ${filename}.`);
    }

    names.add(filename);
    return { filename, prompt };
  });

  return { batchTheme, compositions };
}

function updateMusicBatchPreview() {
  const input = document.getElementById("music-batch-document");
  const preview = document.getElementById("music-batch-preview");
  if (!input || !preview) return;

  preview.replaceChildren();
  if (!input.value.trim()) return;

  try {
    const { batchTheme, compositions } = parseMusicBatchDocument(input.value);
    const heading = document.createElement("p");
    heading.textContent = `${batchTheme} — ${compositions.length} compositions ready`;
    preview.appendChild(heading);

    const list = document.createElement("ol");
    for (const composition of compositions) {
      const item = document.createElement("li");
      item.textContent = composition.filename;
      list.appendChild(item);
    }
    preview.appendChild(list);
  } catch (error) {
    const message = document.createElement("p");
    message.textContent = error.message;
    message.setAttribute("role", "alert");
    preview.appendChild(message);
  }
}

document.getElementById("music-batch-document")
  ?.addEventListener("input", updateMusicBatchPreview);
