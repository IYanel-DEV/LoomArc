'use strict';

require('dotenv').config();
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

function required(key) {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
}

function int(key, fallback) {
  const v = process.env[key];
  return v ? parseInt(v, 10) : fallback;
}

module.exports = {
  panel: {
    port: int('PANEL_PORT', 3000),
    host: process.env.PANEL_HOST || '0.0.0.0',
  },

  apiSecret: process.env.API_SECRET || 'dev_secret',

  jwtSecret: process.env.JWT_SECRET || process.env.API_SECRET || 'dev_jwt_secret',

  dataDir: process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(ROOT, 'data'),

  javaPath: process.env.JAVA_PATH || 'java',

  ports: {
    bungeeStart: int('BUNGEE_PORT_START', 25565),
    bungeeEnd:   int('BUNGEE_PORT_END',   25665),
    serverStart: int('SERVER_PORT_START',  25701),
    serverEnd:   int('SERVER_PORT_END',    26200),
  },

  process: {
    consoleBuffer:       int('CONSOLE_BUFFER_LINES',    500),
    gracefulStopTimeout: int('GRACEFUL_STOP_TIMEOUT', 30000),
  },

  logsDir: path.join(ROOT, 'logs'),
};
