const { app, BrowserWindow, protocol, net } = require('electron');
const { pathToFileURL } = require('url');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

// Register 'app' scheme as privileged to support CORS and Fetch correctly
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

let mainWindow;
let backendProcess;
let redisProcess;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: "Tell Me.",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js') // Preload script if needed
    },
    backgroundColor: '#070913' // Fits the dark-to-purple premium landing screen background
  });

  // In production, load the Next.js static export folder via custom app:// protocol
  const isDev = !app.isPackaged;
  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    // Open DevTools in dev mode
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadURL('app://index.html').catch(err => {
      console.error("Failed to load Next.js static files via app://:", err);
    });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function startServices() {
  const isDev = !app.isPackaged;
  
  // 1. Resolve binary paths for Python backend and Redis
  let backendBinPath = "";
  let redisBinPath = "redis-server"; // Default system command fallback

  if (isDev) {
    backendBinPath = path.join(__dirname, '../backend/dist/backend-service/backend-service');
  } else {
    // In production, binaries are copied to process.resourcesPath (Contents/Resources)
    backendBinPath = path.join(process.resourcesPath, 'backend-service/backend-service');
    
    // Check if bundled redis-server binary exists in Resources
    const bundledRedis = path.join(process.resourcesPath, 'redis-server');
    if (fs.existsSync(bundledRedis)) {
      redisBinPath = bundledRedis;
    } else {
      // Fallback for macOS standard Homebrew install locations
      const paths = ['/opt/homebrew/bin/redis-server', '/usr/local/bin/redis-server'];
      for (const p of paths) {
        if (fs.existsSync(p)) {
          redisBinPath = p;
          break;
        }
      }
    }
  }

  console.log(`Resolved Python backend path: ${backendBinPath}`);
  console.log(`Resolved Redis server path: ${redisBinPath}`);

  // 2. Spawn local Redis Server
  try {
    // Only accept connections from this computer.
    const redisArgs = ['--port', '6379', '--bind', '127.0.0.1'];
    
    // In production, save data to the user's Application Support directory
    if (!isDev) {
      const appDataDir = path.join(app.getPath('appData'), 'Tell Me');
      if (!fs.existsSync(appDataDir)) {
        fs.mkdirSync(appDataDir, { recursive: true });
      }
      redisArgs.push('--dir', appDataDir);
    }
    
    console.log("Launching local Redis Server...");
    redisProcess = spawn(redisBinPath, redisArgs);
    
    redisProcess.stdout.on('data', (data) => {
      console.log(`[Redis Stdout]: ${data}`);
    });
    
    redisProcess.stderr.on('data', (data) => {
      console.error(`[Redis Stderr]: ${data}`);
    });
  } catch (err) {
    console.error("Failed to launch local Redis server sidecar:", err);
  }

  // 3. Spawn compiled FastAPI Python Backend
  if (fs.existsSync(backendBinPath)) {
    try {
      console.log("Launching local FastAPI Python Backend...");
      
      // Override backend settings if running packaged (e.g. binding to standard port 8000)
      const env = { 
        ...process.env, 
        PORT: "8000",
        HOST: "127.0.0.1",
        REDIS_HOST: "127.0.0.1",
        REDIS_PORT: "6379",
        PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${process.env.PATH || ''}`
      };
      
      const backendDir = path.dirname(backendBinPath);
      backendProcess = spawn(backendBinPath, [], { env, cwd: backendDir });
      
      backendProcess.stdout.on('data', (data) => {
        console.log(`[Backend Stdout]: ${data}`);
      });
      
      backendProcess.stderr.on('data', (data) => {
        console.error(`[Backend Stderr]: ${data}`);
      });
    } catch (err) {
      console.error("Failed to launch compiled FastAPI backend sidecar:", err);
    }
  } else {
    console.warn(`FastAPI backend binary not found at ${backendBinPath}. Launching UI only.`);
  }
}

function stopServices() {
  console.log("Stopping background sidecar services...");
  if (backendProcess) {
    console.log("Killing Python FastAPI backend process...");
    backendProcess.kill('SIGTERM');
  }
  if (redisProcess) {
    console.log("Killing Redis server process...");
    redisProcess.kill('SIGTERM');
  }
}

app.on('ready', () => {
  // Register the custom app:// protocol handler
  protocol.handle('app', (request) => {
    try {
      const parsedUrl = new URL(request.url);
      const cleanPath = parsedUrl.pathname === '/' ? 'index.html' : parsedUrl.pathname;
      let filePath = path.join(__dirname, 'out', cleanPath);
      
      // Fallback if file doesn't exist or points to a folder
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(__dirname, 'out', 'index.html');
      }
      
      return net.fetch(pathToFileURL(filePath).toString());
    } catch (e) {
      console.error("Failed to route custom protocol:", e);
      return new Response("Protocol routing error", { status: 500 });
    }
  });

  startServices();
  // Wait a short moment for Redis/FastAPI to launch before opening the window
  setTimeout(createWindow, 800);
});

app.on('window-all-closed', () => {
  // Respect macOS standard quit guidelines
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

app.on('before-quit', () => {
  stopServices();
});
