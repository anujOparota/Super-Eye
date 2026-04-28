# 👁 Super Eye — Smart Detection System

Real-time face detection with a modern web UI for finding lost people in photos and live video streams.

---

## ⚡ Quick Start

### 1. Clone the Repository

```bash
git clone <your-repo-url>
cd Super-Eye
```

### 2. Install Dependencies

Navigate to the Interface folder and install requirements:

```bash
cd Interface
pip install -r requirements.txt
```

> **Windows users:** See [Interface/README.md](Interface/README.md#quick-start) for pre-installation steps (Python, CMake, Visual Studio Build Tools)

### 3. Start the Backend Server

```bash
python backend/server.py
```

The server will start and wait for the web UI to connect.

### 4. Open the Web Interface

Open `Interface/index.html` in your browser (Chrome or Edge recommended).

You should see **BACKEND CONNECTED** in green at the top when the connection is successful.

---

## 📖 Full Documentation

For detailed usage instructions, detection features, keyboard shortcuts, and configuration options, see:

**[Interface/README.md](Interface/README.md)**

---

## 📁 Project Structure

```
Super-Eye/
├── Interface/          ← Main application (web UI + backend)
│   ├── index.html      ← Open in browser
│   ├── backend/
│   │   └── server.py   ← WebSocket server
│   ├── static/         ← CSS & JavaScript
│   └── README.md       ← Full documentation
├── Smart_Detection_System/  ← Alternative standalone version
└── Resources/          ← Project resources
```

---

## 🎮 Usage

1. **Add people** — Drag photos onto the left panel
2. **Detect** — Start live camera or upload video
3. **View results** — See matches with timestamp and confidence
4. **Export** — Download detection log as CSV

For keyboard shortcuts and advanced settings, see the [full README](Interface/README.md#using-the-interface).
