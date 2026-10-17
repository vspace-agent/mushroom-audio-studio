// Convert authorized videos locally or through the passcode-protected cloud API.
const form = document.querySelector("#converter-form");
const button = document.querySelector("#convert-button");
const status = document.querySelector("#status");
const cloudAccess = document.querySelector("#cloud-access");
const passcodeInput = document.querySelector("#cloud-passcode");

const cloudMode = location.hostname === "vspace-agent.github.io";
const cloudAPI = "https://mushroom-audio-studio-611800232785.europe-west3.run.app";

cloudAccess.hidden = !cloudMode;
passcodeInput.required = cloudMode;
button.disabled = false;

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  button.disabled = true;
  status.textContent = "Converting audio…";

  try {
    const headers = {"Content-Type": "application/json"};
    if (cloudMode) {
      headers["X-Mushroom-Passcode"] = passcodeInput.value;
    }

    const response = await fetch(
      cloudMode ? cloudAPI + "/api/convert" : "/api/convert",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          url: document.querySelector("#video-url").value.trim(),
          audio_format: document.querySelector("#audio-format").value
        })
      }
    );

    if (!response.ok) {
      let message = "Conversion failed.";
      try {
        const error = await response.json();
        message = error.detail || message;
      } catch (_) {
        message = "Conversion failed (HTTP " + response.status + ").";
      }
      throw new Error(message);
    }

    if (cloudMode) {
      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") || "";
      const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i);
      const plain = disposition.match(/filename="?([^";]+)"?/i);
      const filename = encoded
        ? decodeURIComponent(encoded[1])
        : plain ? plain[1] : "mushroom-audio." +
          document.querySelector("#audio-format").value;
      const objectURL = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectURL;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(objectURL), 60000);
      status.textContent = "Audio downloaded: " + filename;
    } else {
      const result = await response.json();
      if (result.status !== "saved" || !result.filename) {
        throw new Error("Unexpected converter response.");
      }
      status.textContent = "Saved to audio library: " + result.filename;
    }
  } catch (error) {
    status.textContent = error.message || "Conversion failed.";
  } finally {
    button.disabled = false;
  }
});
