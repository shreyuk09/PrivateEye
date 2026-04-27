# PrivateEye — Shoulder Surfing Detector

A privacy guardian web app that uses your webcam to detect when **more than one person** is looking at your screen — and instantly hides your content.

- 1 face → `SAFE` (green border)
- 2+ faces → `WARNING` + alarm + privacy blur + auto-snapshot

100% client-side. No video, image, or telemetry leaves your machine.

---

## Features

### Detection
- Real-time face detection at ~30 fps using **TensorFlow.js + BlazeFace**
- Animated bounding boxes with corner accents and confidence scores
- Live FPS + face count HUD on the video
- Adjustable **sensitivity** (1–10 frames before alert fires) — kills false positives

### Privacy guardrails (when 2+ faces detected)
- 🛑 **Auto privacy blur** — overlays the entire page in a frosted-glass shield until you dismiss
- 🔔 **Sound alarm** — generated 880 Hz beep loop via Web Audio API (no external file)
- 📸 **Auto snapshot** — captures the moment of intrusion to the in-browser alert log
- 🔔 **Desktop notifications** — alerts you even when the tab is in the background

### UX & utilities
- Manual snapshot button + downloadable JPEG
- Camera switch (front ↔ rear) for laptops with multiple cameras
- Live session timer (mm:ss)
- Live stat tiles: total alerts, faces now, current status
- Alert history with thumbnails — click any entry to download the snapshot
- Toast notifications for actions
- Settings persist via `localStorage`

### Polish
- Modern dark UI with Inter typography
- Smooth animations (spinner, pulse, fade)
- Fully responsive — single-column layout on mobile/narrow screens
- 100% client-side — no backend, no telemetry

---

## File structure

```
shoulder-surfing-detector/
├── index.html       # Page layout + CDN scripts
├── styles.css       # Theme + components
├── app.js           # Detection + UI logic
└── README.md
```

---

## Setup & run

There's nothing to install — TensorFlow.js and BlazeFace load from a CDN. You just need to serve the folder over HTTP because `getUserMedia` requires a secure context.

### Option 1 — Python (simplest)
```bash
cd shoulder-surfing-detector
python3 -m http.server 8000
```
Open <http://localhost:8000>

### Option 2 — Node
```bash
npx serve shoulder-surfing-detector
```

### Option 3 — VS Code
Install **Live Server**, right-click `index.html` → *Open with Live Server*.

### Option 4 — GitHub Pages
Push the folder to a repo, enable Pages on `main`, visit the URL. (HTTPS is required for camera access on hosted pages.)

---

## Using it

1. Open the URL in **Chrome / Edge / Firefox / Safari**.
2. Click **▶ Start monitoring** and allow camera access.
3. Sit in front of the camera. Status banner turns **green: Safe**.
4. Have someone peek over your shoulder.
5. After the sensitivity threshold (default 3 frames), the page **blurs**, the alarm **beeps**, and a snapshot is saved to **Alert history**.
6. Once you're alone, click **I'm alone now — show screen** to dismiss.

---

## Settings explained

| Setting | What it does |
|---|---|
| **Sensitivity** | How many consecutive frames must show >1 face before alerting. Lower = faster alerts, more false positives. Higher = steadier, slower. Default **3**. |
| **Sound alert** | Plays a beeping alarm during warnings (Web Audio API). |
| **Auto privacy blur** | Hides page content with a frosted overlay until you dismiss. |
| **Auto snapshot** | Captures a JPEG when an alert fires; stays in browser memory and appears in the log. |
| **Desktop notifications** | Sends OS-level notification when alert fires while tab is hidden. Requires permission. |

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Camera access denied | URL bar → camera icon → *Always allow* |
| Model never finishes loading | First load fetches BlazeFace from CDN — check network |
| Faces missed | Improve lighting; sit closer; remove busy backgrounds |
| Beep doesn't play | Click *Start* first — browsers block audio before user gesture |
| Notifications never appear | Toggle them on, accept the prompt, hide the tab |
| Hosted site fails | `getUserMedia` requires HTTPS — use GitHub Pages or any TLS host |

---

## Built with

- [TensorFlow.js](https://www.tensorflow.org/js) v4.17
- [BlazeFace](https://github.com/tensorflow/tfjs-models/tree/master/blazeface) — lightweight (~400 KB) face detector
- Vanilla HTML, CSS, JavaScript — no frameworks, no build step
