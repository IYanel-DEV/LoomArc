'use strict';

const path    = require('path');
const fs      = require('fs');
const winston = require('winston');
const config  = require('../config');

fs.mkdirSync(config.logsDir, { recursive: true });

const fmt = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message }) =>
    `[${timestamp}] [${level.toUpperCase().padEnd(5)}] ${message}`
  )
);

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: fmt,
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        fmt
      ),
    }),
    new winston.transports.File({
      filename: path.join(config.logsDir, 'loomarc.log'),
      maxsize:  10 * 1024 * 1024, // 10 MB
      maxFiles: 5,
      tailable: true,
    }),
  ],
});

module.exports = logger;
