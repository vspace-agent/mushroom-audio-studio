// Connect Audio Studio's batch composer to sequential Kaggle generation.

(() => {
  const hosted = location.hostname === "vspace-agent.github.io";
  const apiBase = hosted
    ? "https://audio-studio-api-jwu3axpvwq-ey.a.run.app"
    : "";
  const api = (path) => apiBase + path;
  const form = document.querySelector("#music-form");


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



  function turnReport(job) {
    const progress = job.progress;
    if (!Array.isArray(progress?.turns) || !progress.turns.length) {
      return null;
    }

    const lines = progress.turns.map(turn => {
      const notebook = turn.notebook
        ? (turn.notebook.endsWith("-b") ? "B" : turn.notebook.endsWith("-c") ? "C" : "A")
        : null;
      const model = {turbo: "Turbo", sft_lm: "SFT + LM"}[turn.route];
      const configuration = [
        notebook ? `Notebook ${notebook}` : null,
        model,
        turn.batch_size ? `size ${turn.batch_size}` : null,
      ].filter(Boolean).join(" · ");
      const prefix = `Turn ${turn.turn}/${progress.turns.length}` +
        (configuration ? ` — ${configuration}` : "");
      const audioTarget = Number.isInteger(turn.expected_recordings)
        ? `/${turn.expected_recordings}`
        : "";
      if (turn.finished) {
        const outcome = turn.state === "failed" ? "Failed" : "Finished";
        return `${prefix} — ${outcome} · ${turn.completed}/${turn.expected} compositions returned · ${turn.recordings}${audioTarget} audio files`;
      }
      const labels = {
        pending: "Waiting",
        submitting: "Submitting to Kaggle",
        submitted: "Generating / awaiting Kaggle",
        collecting: "Collecting recordings",
        uncertain: "Awaiting submission verification",
      };
      const expected = Number.isInteger(turn.expected_recordings)
        ? `${turn.expected} compositions · ${turn.expected_recordings} expected audio files`
        : `${turn.expected} expected compositions`;
      return `${prefix} — ${labels[turn.state] || turn.state} · ${expected}`;
    });

    if (job.state === "complete") {
      lines.push(`Batch finished · ${progress.recordings} audio files collected`);
    } else if (job.state === "failed" || job.state === "error") {
      lines.push(job.error || "Batch stopped.");
    }

    return lines.join("\n");
  }

  function render(job) {
    const running = ["accepted", "running"].includes(job.state);
    button.disabled = running;
    button.textContent = running ? "Composing…" : "Generate batch";

    const report = turnReport(job);
    if (report !== null) {
      const seconds = job.elapsed_seconds;
      const elapsed = running && Number.isFinite(seconds)
        ? `\n${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s elapsed`
        : "";

      status.style.whiteSpace = "pre-line";
      message(report + elapsed);
      if (!running) stopPolling();
      activeJob = running ? job.id : null;
      return;
    }

    if (running) {
      const stages = {
        starting: "Preparing your composition",
        accepted: "Composition accepted by cloud",
        kaggle_submitting: "Submitting composition to Kaggle",
        kaggle_submitted: "Kaggle is processing your composition",
        collecting: "Collecting generated recordings",
        gcs_verified: "Recordings verified in cloud storage",
        worker_failed: "Cloud generation failed",
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
        String(job.stage || "running").replaceAll("_", " ").toLowerCase();
      const waiting = job.stage === "MONITORING" &&
        kaggleStatus && kaggleStatus !== "COMPLETE";
      const seconds = job.elapsed_seconds;
      const elapsed = Number.isFinite(seconds)
        ? ` · ${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s elapsed`
        : "";
      const progress = job.progress;
      const progressLabel = progress
        ? ` · ${progress.completed}/${progress.total} variations complete` +
          (progress.failed ? ` · ${progress.failed} failed` : "")
        : "";
      message((waiting
        ? `Waiting for Kaggle (${kaggleStatus})…`
        : `${label}…`) + progressLabel + elapsed);
    } else if (job.state === "complete") {
      message(`Batch finished · ${job.generated_flacs || 0} audio files collected`);
      stopPolling();
    } else if (job.state === "error" || job.state === "failed") {
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
            route: "mixed",
            duration_seconds: Number(duration.value),
            variations: 3,
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
