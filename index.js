const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

const DATA_FILE = path.join(__dirname, 'bots.json');
const LOG_DIR = path.join(__dirname, 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

let bots = {};
let processes = {}; // name -> child_process

// Load or init bots.json
if (fs.existsSync(DATA_FILE)) {
  try { bots = JSON.parse(fs.readFileSync(DATA_FILE)); } catch (e) { bots = {}; }
} else {
  fs.writeFileSync(DATA_FILE, JSON.stringify({}));
}

function saveBots() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(bots, null, 2));
}

// API: get bots
app.get('/api/bots', (req, res) => {
  const list = Object.keys(bots).map(name => ({ name, ...bots[name], running: !!processes[name] }));
  res.json(list);
});

// API: add bot
// body: { name, type: 'telegram'|'whatsapp'|'custom', path, startCommand }
app.post('/api/bots', (req, res) => {
  const { name, type, path: botPath, startCommand } = req.body;
  if (!name || !botPath || !startCommand) return res.status(400).json({ error: 'name, path and startCommand are required' });
  if (bots[name]) return res.status(400).json({ error: 'Bot name already exists' });
  bots[name] = { type: type || 'custom', path: botPath, startCommand };
  saveBots();
  res.json({ ok: true, bot: { name, ...bots[name] } });
});

// API: remove bot
app.delete('/api/bots/:name', (req, res) => {
  const name = req.params.name;
  if (!bots[name]) return res.status(404).json({ error: 'Bot not found' });
  if (processes[name]) {
    processes[name].kill();
    delete processes[name];
  }
  delete bots[name];
  saveBots();
  res.json({ ok: true });
});

// API: start bot
app.post('/api/bots/:name/start', (req, res) => {
  const name = req.params.name;
  const bot = bots[name];
  if (!bot) return res.status(404).json({ error: 'Bot not found' });
  if (processes[name]) return res.status(400).json({ error: 'Bot already running' });

  const logFile = path.join(LOG_DIR, `${name}.log`);
  const out = fs.createWriteStream(logFile, { flags: 'a' });

  // spawn using shell so commands like "python main.py" or "node bot.js" work
  const child = spawn(bot.startCommand, { cwd: bot.path, shell: true, detached: false });

  child.stdout.on('data', data => {
    out.write(`[STDOUT ${new Date().toISOString()}] ${data}`);
  });
  child.stderr.on('data', data => {
    out.write(`[STDERR ${new Date().toISOString()}] ${data}`);
  });
  child.on('exit', (code, signal) => {
    out.write(`[EXIT ${new Date().toISOString()}] code=${code} signal=${signal}\n`);
    if (processes[name]) delete processes[name];
  });

  processes[name] = child;
  res.json({ ok: true });
});

// API: stop bot
app.post('/api/bots/:name/stop', (req, res) => {
  const name = req.params.name;
  const child = processes[name];
  if (!child) return res.status(400).json({ error: 'Bot not running' });
  try {
    child.kill();
    delete processes[name];
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to stop', details: e.message });
  }
});

// API: get logs (last 2000 chars)
app.get('/api/bots/:name/logs', (req, res) => {
  const name = req.params.name;
  const logFile = path.join(LOG_DIR, `${name}.log`);
  if (!fs.existsSync(logFile)) return res.json({ logs: '' });
  const data = fs.readFileSync(logFile, 'utf8');
  // return last ~20000 chars to be safe
  res.json({ logs: data.slice(-20000) });
});

// Serve UI
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Sinhala Bot Panel running on port ${PORT}`);
});

