#!/usr/bin/env node

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

// ─── ANSI colors ────────────────────────────────────────────────────────────

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

// ─── CLI entry point ────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const command = args[0];

if (!command || command === '--help' || command === '-h') {
  printHelp();
  process.exit(0);
}

switch (command) {
  case 'init':
    cmdInit(args.slice(1));
    break;
  case 'build':
    cmdBuild(args.slice(1));
    break;
  default:
    console.error(red(`Unknown command: ${command}`));
    console.error(`Run ${cyan('npx org-asm --help')} for available commands.`);
    process.exit(1);
}

// ─── Help ───────────────────────────────────────────────────────────────────

function printHelp() {
  console.log(`
${bold('org-asm')} ${dim('— Rust-first MVC for 60fps React applications')}

${bold('USAGE')}
  npx org-asm ${cyan('<command>')} [options]

${bold('COMMANDS')}
  ${cyan('init')} ${dim('<project-name>')}   Scaffold a new org-asm project
  ${cyan('build')}                  Run the full build pipeline

${bold('EXAMPLES')}
  npx org-asm init my-app
  cd my-app && npx org-asm build
`);
}

// ─── Init command ───────────────────────────────────────────────────────────

function cmdInit(initArgs) {
  if (initArgs.includes('--help') || initArgs.includes('-h')) {
    console.log(`
${bold('org-asm init')} ${dim('<project-name>')}

Scaffold a new org-asm project with:
  - Rust workspace (shared, engine, server crates)
  - FlatBuffers schema
  - React + TypeScript frontend
  - Build pipeline script
`);
    process.exit(0);
  }

  const projectName = initArgs[0];
  if (!projectName) {
    console.error(red('Error: project name is required.'));
    console.error(`Usage: ${cyan('npx org-asm init <project-name>')}`);
    process.exit(1);
  }

  // Validate project name (allow alphanumeric, hyphens, underscores)
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(projectName)) {
    console.error(red('Error: project name must start with a letter and contain only letters, numbers, hyphens, and underscores.'));
    process.exit(1);
  }

  const projectDir = resolve(projectName);

  if (existsSync(projectDir)) {
    console.error(red(`Error: directory "${projectName}" already exists.`));
    process.exit(1);
  }

  console.log(`\n${bold('Creating')} ${cyan(projectName)}...\n`);

  // Rust crate name: hyphens to underscores
  const crateName = projectName.replace(/-/g, '_');

  // Create directory tree
  const dirs = [
    '',
    'schema',
    'crates',
    'crates/shared',
    'crates/shared/src',
    'crates/engine',
    'crates/engine/src',
    'crates/server',
    'crates/server/src',
    'src',
    'scripts',
  ];

  for (const dir of dirs) {
    const fullPath = join(projectDir, dir);
    mkdirSync(fullPath, { recursive: true });
    console.log(`  ${dim('mkdir')} ${dir || '.'}/`);
  }

  // Generate files
  const files = getTemplateFiles(projectName, crateName);

  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = join(projectDir, relPath);
    writeFileSync(fullPath, content, 'utf-8');
    console.log(`  ${green('create')} ${relPath}`);
  }

  // Make build.sh executable
  try {
    execSync(`chmod +x "${join(projectDir, 'scripts/build.sh')}"`);
  } catch {
    // Non-critical on Windows
  }

  // Print success
  console.log(`
${green(bold('Done!'))} Project ${cyan(projectName)} created.

${bold('Next steps:')}

  ${cyan(`cd ${projectName}`)}
  ${cyan('npm install')}
  ${cyan('npx org-asm build')}

${bold('Prerequisites:')}
  ${dim('-')} ${cyan('flatc')}      ${dim('https://github.com/google/flatbuffers/releases')}
  ${dim('-')} ${cyan('wasm-pack')}  ${dim('https://rustwasm.github.io/wasm-pack/installer/')}
  ${dim('-')} ${cyan('cargo')}      ${dim('https://rustup.rs')}
`);
}

// ─── Build command ──────────────────────────────────────────────────────────

function cmdBuild(buildArgs) {
  if (buildArgs.includes('--help') || buildArgs.includes('-h')) {
    console.log(`
${bold('org-asm build')}

Run the full build pipeline:
  1. flatc --rust  (compile .fbs schemas to Rust)
  2. flatc --ts    (compile .fbs schemas to TypeScript)
  3. wasm-pack     (build WASM engine crate)
  4. cargo build   (build server crate)
`);
    process.exit(0);
  }

  console.log(`\n${bold('org-asm build pipeline')}\n`);

  const steps = [
    {
      name: 'FlatBuffers (Rust)',
      run: () => {
        const schemaDir = resolve('schema');
        if (!existsSync(schemaDir)) {
          throw new Error('schema/ directory not found. Run from project root.');
        }
        const fbsFiles = readdirSync(schemaDir).filter((f) => f.endsWith('.fbs'));
        if (fbsFiles.length === 0) {
          console.log(dim('    No .fbs files found in schema/, skipping.'));
          return;
        }
        mkdirSync(resolve('crates/engine/src/generated'), { recursive: true });
        for (const fbs of fbsFiles) {
          const cmd = `flatc --rust -o crates/engine/src/generated/ schema/${fbs}`;
          console.log(dim(`    $ ${cmd}`));
          execSync(cmd, { stdio: 'inherit' });
        }
      },
    },
    {
      name: 'FlatBuffers (TypeScript)',
      run: () => {
        const schemaDir = resolve('schema');
        const fbsFiles = readdirSync(schemaDir).filter((f) => f.endsWith('.fbs'));
        if (fbsFiles.length === 0) {
          console.log(dim('    No .fbs files found in schema/, skipping.'));
          return;
        }
        mkdirSync(resolve('src/generated'), { recursive: true });
        for (const fbs of fbsFiles) {
          const cmd = `flatc --ts -o src/generated/ schema/${fbs}`;
          console.log(dim(`    $ ${cmd}`));
          execSync(cmd, { stdio: 'inherit' });
        }
      },
    },
    {
      name: 'WASM engine (wasm-pack)',
      run: () => {
        const engineDir = resolve('crates/engine');
        if (!existsSync(join(engineDir, 'Cargo.toml'))) {
          throw new Error('crates/engine/Cargo.toml not found. Run from project root.');
        }
        const cmd = 'wasm-pack build crates/engine --target web --release --out-dir ../../src/pkg';
        console.log(dim(`    $ ${cmd}`));
        execSync(cmd, { stdio: 'inherit' });
      },
    },
    {
      name: 'Server (cargo)',
      run: () => {
        const serverDir = resolve('crates/server');
        if (!existsSync(join(serverDir, 'Cargo.toml'))) {
          throw new Error('crates/server/Cargo.toml not found. Run from project root.');
        }
        const cmd = 'cargo build --release -p server';
        console.log(dim(`    $ ${cmd}`));
        execSync(cmd, { stdio: 'inherit' });
      },
    },
  ];

  let passed = 0;
  let failed = 0;

  for (const step of steps) {
    const label = `[${passed + failed + 1}/${steps.length}] ${step.name}`;
    process.stdout.write(`${cyan(bold(label))}... `);
    try {
      console.log('');
      step.run();
      console.log(`${green(bold(label))} ${green('OK')}\n`);
      passed++;
    } catch (err) {
      console.log(`${red(bold(label))} ${red('FAILED')}\n`);
      console.error(red(`  ${err.message}`));
      failed++;
    }
  }

  console.log(`\n${bold('Build complete:')} ${green(`${passed} passed`)}, ${failed > 0 ? red(`${failed} failed`) : dim('0 failed')}\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

// ─── Template files ─────────────────────────────────────────────────────────

function getTemplateFiles(projectName, crateName) {
  return {
    // ── Workspace Cargo.toml ──────────────────────────────────────────────
    'Cargo.toml': `[workspace]
resolver = "2"
members = [
    "crates/shared",
    "crates/engine",
    "crates/server",
]
`,

    // ── package.json ─────────────────────────────────────────────────────
    'package.json': `{
  "name": "${projectName}",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "npx org-asm build",
    "build:wasm": "wasm-pack build crates/engine --target web --release --out-dir ../../src/pkg",
    "build:schema": "flatc --ts -o src/generated/ schema/frame.fbs",
    "dev": "vite",
    "preview": "vite preview"
  },
  "dependencies": {
    "org-asm": "^0.1.0",
    "flatbuffers": "^24.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0",
    "@vitejs/plugin-react": "^4.0.0"
  }
}
`,

    // ── tsconfig.json ────────────────────────────────────────────────────
    'tsconfig.json': `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src"]
}
`,

    // ── FlatBuffers schema ───────────────────────────────────────────────
    'schema/frame.fbs': `// FlatBuffers schema for ${projectName}.
//
// This is the single source of truth for the frame structure.
// Generate code for both sides:
//   flatc --rust -o crates/engine/src/generated/ schema/frame.fbs
//   flatc --ts  -o src/generated/ schema/frame.fbs

namespace ${crateName};

/// A single data point in a time series.
table DataPoint {
  timestamp: double;
  value: double;
}

/// Frame output from the engine on each tick.
/// Contains all computed values needed for rendering.
table Frame {
  /// Primary smoothed value for display
  value: double = 0.0;

  /// Normalized value (0.0 to 1.0) for gauges/progress bars
  normalized: double = 0.0;

  /// Rate of change per second
  velocity: double = 0.0;

  /// Whether the value is trending upward
  trending_up: bool = false;

  /// Blend factor for transition animations (0.0 to 1.0)
  blend: double = 0.0;

  /// RGB color derived from current state
  color_r: ubyte = 0;
  color_g: ubyte = 0;
  color_b: ubyte = 0;

  /// Monotonic counter — bumped when time-series data changes
  data_version: uint = 0;

  /// Number of data points currently held
  data_count: uint = 0;
}

root_type Frame;
`,

    // ── Shared crate ─────────────────────────────────────────────────────
    'crates/shared/Cargo.toml': `[package]
name = "shared"
version = "0.1.0"
edition = "2021"

[dependencies]
`,

    'crates/shared/src/lib.rs': `//! Shared types and constants for ${projectName}.
//!
//! This crate is a dependency of both the WASM engine and the native server,
//! ensuring consistent types across the client/server boundary.

/// Application-wide constants.
pub mod constants {
    /// Default history window in seconds.
    pub const HISTORY_WINDOW_SEC: f64 = 60.0;

    /// Exponential smoothing factor (higher = more responsive).
    pub const SMOOTHING_FACTOR: f64 = 0.08;

    /// Minimum change threshold to avoid jitter.
    pub const CHANGE_THRESHOLD: f64 = 0.001;
}
`,

    // ── Engine crate (WASM) ──────────────────────────────────────────────
    'crates/engine/Cargo.toml': `[package]
name = "engine"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
shared = { path = "../shared" }
wasm-bindgen = "0.2"
js-sys = "0.3"
flatbuffers = "24.3"
serde = { version = "1", features = ["derive"] }
serde_json = "1"

[profile.release]
opt-level = "z"
lto = true
`,

    'crates/engine/src/lib.rs': `//! WASM Engine for ${projectName}.
//!
//! Owns all mutable state. Serializes a FlatBuffer frame on each tick.
//! JS reads the frame zero-copy from WASM linear memory.

use wasm_bindgen::prelude::*;
use flatbuffers::FlatBufferBuilder;
use serde::Deserialize;
use shared::constants::*;

// Uncomment after running: flatc --rust -o crates/engine/src/generated/ schema/frame.fbs
// mod generated;
// use generated::${crateName}_generated::*;

#[wasm_bindgen]
pub struct Engine {
    // Time-series data
    timestamps: Vec<f64>,
    values: Vec<f64>,
    data_version: u32,

    // Current state
    current_value: f64,
    prev_value: f64,

    // Animation state (persists across frames)
    smooth_value: f64,
    blend_factor: f64,

    // FlatBuffer builder (reused — allocation-free after first tick)
    builder: FlatBufferBuilder<'static>,
}

#[wasm_bindgen]
impl Engine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Engine {
        Engine {
            timestamps: Vec::new(),
            values: Vec::new(),
            data_version: 0,
            current_value: 0.0,
            prev_value: 0.0,
            smooth_value: 0.0,
            blend_factor: 0.0,
            builder: FlatBufferBuilder::with_capacity(256),
        }
    }

    /// Ingest a data point from a WebSocket message.
    #[wasm_bindgen]
    pub fn add_data_point(&mut self, value: f64, timestamp_sec: f64, now_ms: f64) {
        self.prev_value = self.current_value;
        self.current_value = value;

        self.timestamps.push(timestamp_sec);
        self.values.push(value);

        // Prune old data
        let cutoff = now_ms / 1000.0 - HISTORY_WINDOW_SEC;
        let mut cut = 0;
        while cut < self.timestamps.len().saturating_sub(1) && self.timestamps[cut] < cutoff {
            cut += 1;
        }
        if cut > 0 {
            self.timestamps.drain(0..cut);
            self.values.drain(0..cut);
        }

        self.data_version += 1;
    }

    /// Called once per requestAnimationFrame. Serializes state to FlatBuffer.
    #[wasm_bindgen]
    pub fn tick(&mut self, _now_ms: f64) {
        self.builder.reset();

        // Exponential smoothing
        self.smooth_value += (self.current_value - self.smooth_value) * SMOOTHING_FACTOR;

        // Blend animation
        let blend_target = if self.current_value > CHANGE_THRESHOLD { 1.0 } else { 0.0 };
        self.blend_factor += (blend_target - self.blend_factor) * 0.04;

        // Velocity (rate of change)
        let _velocity = self.current_value - self.prev_value;

        // Normalized value
        let _normalized = self.smooth_value.clamp(0.0, 1.0);

        // TODO: Build FlatBuffer frame here after running flatc codegen.
        // let frame = Frame::create(&mut self.builder, &FrameArgs {
        //     value: self.smooth_value,
        //     normalized: _normalized,
        //     velocity: _velocity,
        //     trending_up: self.current_value > self.prev_value,
        //     blend: self.blend_factor,
        //     color_r: (255.0 * _normalized) as u8,
        //     color_g: (200.0 * (1.0 - _normalized)) as u8,
        //     color_b: 0,
        //     data_version: self.data_version,
        //     data_count: self.timestamps.len() as u32,
        // });
        // self.builder.finish(frame, None);
    }

    /// Pointer to the finished FlatBuffer bytes (zero-copy read from JS).
    #[wasm_bindgen]
    pub fn frame_ptr(&self) -> *const u8 {
        self.builder.finished_data().as_ptr()
    }

    #[wasm_bindgen]
    pub fn frame_len(&self) -> usize {
        self.builder.finished_data().len()
    }

    #[wasm_bindgen]
    pub fn data_version(&self) -> u32 {
        self.data_version
    }

    #[wasm_bindgen]
    pub fn get_timestamps(&self) -> Vec<f64> {
        self.timestamps.clone()
    }

    #[wasm_bindgen]
    pub fn get_values(&self) -> Vec<f64> {
        self.values.clone()
    }

    /// Parse a raw JSON message and ingest it.
    #[wasm_bindgen]
    pub fn ingest_message(&mut self, raw: &str, now_ms: f64) -> u32 {
        #[derive(Deserialize)]
        struct Msg {
            value: f64,
            timestamp: f64,
        }

        let msg: Msg = match serde_json::from_str(raw) {
            Ok(m) => m,
            Err(_) => return 0,
        };
        self.add_data_point(msg.value, msg.timestamp, now_ms);
        1
    }
}
`,

    // ── Server crate ─────────────────────────────────────────────────────
    'crates/server/Cargo.toml': `[package]
name = "server"
version = "0.1.0"
edition = "2021"

[dependencies]
shared = { path = "../shared" }
axum = { version = "0.7", features = ["ws"] }
tokio = { version = "1", features = ["full"] }
tokio-tungstenite = { version = "0.24", features = ["native-tls"] }
futures-util = "0.3"
flatbuffers = "24.3"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tracing = "0.1"
tracing-subscriber = "0.3"

[profile.release]
opt-level = 3
lto = true
`,

    'crates/server/src/main.rs': `//! Server for ${projectName}.
//!
//! Runs three concurrent tasks:
//! 1. Data source ingest (WebSocket or other)
//! 2. Tick loop — serializes state to FlatBuffer at fixed rate
//! 3. Axum WebSocket server — broadcasts frames to browser clients

use std::sync::Arc;
use std::time::Duration;

use axum::{routing::get, Router};
use flatbuffers::FlatBufferBuilder;
use tokio::net::TcpListener;
use tokio::sync::Mutex;
use tracing::info;

mod engine_trait;
mod broadcast;

use broadcast::{ws_handler, BroadcastState};
use engine_trait::ServerEngine;

const TICK_INTERVAL_MS: u64 = 20;
const BIND_ADDR: &str = "0.0.0.0:9001";
const BROADCAST_CAPACITY: usize = 1024;

// Replace with your engine implementation
struct AppEngine {
    value: f64,
    data_version: u32,
}

impl AppEngine {
    fn new() -> Self {
        Self { value: 0.0, data_version: 0 }
    }
}

impl ServerEngine for AppEngine {
    fn ingest(&mut self, msg: &[u8]) -> bool {
        if let Ok(text) = std::str::from_utf8(msg) {
            if let Ok(v) = text.parse::<f64>() {
                self.value = v;
                self.data_version += 1;
                return true;
            }
        }
        false
    }

    fn tick<'a>(&mut self, builder: &'a mut FlatBufferBuilder<'static>) -> &'a [u8] {
        builder.reset();
        // TODO: Serialize state to FlatBuffer after codegen
        builder.finished_data()
    }
}

#[tokio::main]
async fn main() {
    tracing_subscriber::init();

    let engine = Arc::new(Mutex::new(AppEngine::new()));
    let broadcast = BroadcastState::new(BROADCAST_CAPACITY);
    let broadcast_for_tick = broadcast.clone();

    // Tick loop
    let engine_for_tick = engine.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_millis(TICK_INTERVAL_MS));
        let mut builder = FlatBufferBuilder::with_capacity(4096);

        loop {
            interval.tick().await;
            let bytes = {
                let mut eng = engine_for_tick.lock().await;
                let data = eng.tick(&mut builder);
                data.to_vec()
            };
            broadcast_for_tick.send(bytes);
        }
    });

    // HTTP + WebSocket server
    let app = Router::new()
        .route("/ws", get(ws_handler))
        .with_state(broadcast);

    let listener = TcpListener::bind(BIND_ADDR).await.unwrap();
    info!("Server listening on {BIND_ADDR}");

    axum::serve(listener, app).await.unwrap();
}
`,

    'crates/server/src/engine_trait.rs': `use flatbuffers::FlatBufferBuilder;

/// Server-side engine trait.
///
/// Implementors own domain state and serialize it to FlatBuffer bytes on each tick.
pub trait ServerEngine: Send + 'static {
    /// Process a raw message. Returns true if state changed.
    fn ingest(&mut self, msg: &[u8]) -> bool;

    /// Serialize current state to FlatBuffer bytes.
    fn tick<'a>(&mut self, builder: &'a mut FlatBufferBuilder<'static>) -> &'a [u8];

    /// Optional: full state snapshot for late-joining clients.
    fn snapshot(&self, _builder: &mut FlatBufferBuilder<'static>) -> Option<Vec<u8>> {
        None
    }
}
`,

    'crates/server/src/broadcast.rs': `use std::sync::Arc;

use axum::{
    extract::{
        ws::{Message, WebSocket},
        State, WebSocketUpgrade,
    },
    response::IntoResponse,
};
use futures_util::{SinkExt, StreamExt};
use tokio::sync::broadcast;
use tracing::{info, warn};

#[derive(Clone)]
pub struct BroadcastState {
    tx: broadcast::Sender<Arc<Vec<u8>>>,
}

impl BroadcastState {
    pub fn new(capacity: usize) -> Self {
        let (tx, _) = broadcast::channel(capacity);
        Self { tx }
    }

    pub fn send(&self, bytes: Vec<u8>) -> usize {
        self.tx.send(Arc::new(bytes)).unwrap_or(0)
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Arc<Vec<u8>>> {
        self.tx.subscribe()
    }
}

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<BroadcastState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_client(socket, state))
}

async fn handle_client(socket: WebSocket, state: BroadcastState) {
    let (mut ws_tx, mut ws_rx) = socket.split();
    let mut rx = state.subscribe();

    info!("Client connected");

    loop {
        tokio::select! {
            result = rx.recv() => {
                match result {
                    Ok(bytes) => {
                        if ws_tx.send(Message::Binary((*bytes).clone().into())).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        warn!("Client lagged, skipped {n} frames");
                    }
                    Err(broadcast::error::RecvError::Closed) => {
                        break;
                    }
                }
            }
            msg = ws_rx.next() => {
                match msg {
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Err(_)) => break,
                    _ => {}
                }
            }
        }
    }

    info!("Client disconnected");
}
`,

    // ── React frontend ───────────────────────────────────────────────────
    'src/main.tsx': `import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
`,

    'src/App.tsx': `import { useWasm, useAnimationLoop } from 'org-asm/react';
import { useFrame, useConnection } from './hooks';

// Import your WASM init function (available after wasm-pack build)
// import init, { Engine } from './pkg/engine';

// Import generated FlatBuffer reader (available after flatc --ts)
// import { Frame } from './generated/frame';
// import { ByteBuffer } from 'flatbuffers';

export function App() {
  // 1. Initialize WASM module
  // const { memory, ready, error } = useWasm(() => init());

  // 2. Create engine instance (once WASM is ready)
  // const engine = useMemo(() => ready ? new Engine() : null, [ready]);

  // 3. Start animation loop — reads FlatBuffer frames at 60fps
  // const loop = useAnimationLoop(
  //   engine,
  //   memory,
  //   (bytes) => Frame.getRootAsFrame(new ByteBuffer(bytes)),
  // );

  // 4. Connect to server WebSocket for live data
  // const { connected } = useConnection('ws://localhost:9001/ws', engine);

  // 5. Read frame data in render
  // const frame = useFrame(loop);

  return (
    <div style={{ fontFamily: 'system-ui', padding: '2rem' }}>
      <h1>org-asm</h1>
      <p>Rust-first MVC for 60fps React applications.</p>

      <section>
        <h2>Getting started</h2>
        <ol>
          <li>
            <code>npx org-asm build</code> to compile schemas, WASM, and server
          </li>
          <li>Uncomment the hooks in this file to wire up the engine</li>
          <li>
            <code>npm run dev</code> to start the Vite dev server
          </li>
        </ol>
      </section>

      {/* Example: render frame data
      {frame && (
        <div>
          <p>Value: {frame.value()?.toFixed(4)}</p>
          <p>Trend: {frame.trendingUp() ? 'UP' : 'DOWN'}</p>
          <div style={{
            width: 200,
            height: 20,
            background: '#eee',
            borderRadius: 4,
          }}>
            <div style={{
              width: \`\${(frame.normalized() ?? 0) * 100}%\`,
              height: '100%',
              background: \`rgb(\${frame.colorR()}, \${frame.colorG()}, \${frame.colorB()})\`,
              borderRadius: 4,
              transition: 'none',
            }} />
          </div>
        </div>
      )}
      */}
    </div>
  );
}
`,

    'src/hooks.ts': `/**
 * Application-specific hooks.
 *
 * These wrap org-asm primitives for your domain.
 * Customize as needed.
 */

import { useState, useEffect, useCallback } from 'react';

/**
 * useFrame — Subscribe to the latest frame from an AnimationLoop.
 *
 * Returns null until the first frame is produced.
 */
export function useFrame<F>(loop_: { subscribe(cb: (frame: F) => void): () => void } | null): F | null {
  const [frame, setFrame] = useState<F | null>(null);

  useEffect(() => {
    if (!loop_) return;
    return loop_.subscribe(setFrame);
  }, [loop_]);

  return frame;
}

/**
 * useConnection — Manage a WebSocket connection that feeds data to the engine.
 *
 * Reconnects automatically on disconnect.
 */
export function useConnection(
  url: string,
  engine: { ingest_message(raw: string, now: number): number } | null,
) {
  const [connected, setConnected] = useState(false);

  const connect = useCallback(() => {
    if (!engine) return;

    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      // Reconnect after 3s
      setTimeout(connect, 3000);
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        engine.ingest_message(ev.data, Date.now());
      }
    };

    return () => ws.close();
  }, [url, engine]);

  useEffect(() => {
    const cleanup = connect();
    return cleanup;
  }, [connect]);

  return { connected };
}
`,

    // ── Build script ─────────────────────────────────────────────────────
    'scripts/build.sh': `#!/usr/bin/env bash
set -euo pipefail

# Build pipeline for ${projectName}
# Equivalent to: npx org-asm build

echo "=== Building ${projectName} ==="

echo ""
echo "[1/4] FlatBuffers (Rust)..."
mkdir -p crates/engine/src/generated
for f in schema/*.fbs; do
  [ -f "$f" ] || continue
  echo "  flatc --rust $f"
  flatc --rust -o crates/engine/src/generated/ "$f"
done

echo ""
echo "[2/4] FlatBuffers (TypeScript)..."
mkdir -p src/generated
for f in schema/*.fbs; do
  [ -f "$f" ] || continue
  echo "  flatc --ts $f"
  flatc --ts -o src/generated/ "$f"
done

echo ""
echo "[3/4] WASM engine (wasm-pack)..."
wasm-pack build crates/engine --target web --release --out-dir ../../src/pkg

echo ""
echo "[4/4] Server (cargo)..."
cargo build --release -p server

echo ""
echo "=== Build complete ==="
`,
  };
}
