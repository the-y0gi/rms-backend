require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const connectDB = require('./config/db');
const chalk = require('chalk');
const logger = require('./shared/utils/logger');

const app = express();

// Connect Database
connectDB();

// Global Middlewares
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// HTTP Request Logging
app.use(
  morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev', {
    stream: {
      write: (message) => logger.info(message.trim()),
    },
  })
);

// Register Modules
const { initMenuModule } = require('./modules/menu');
initMenuModule(app);

// Health Check Route
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'RMS Backend is running smoothly.' });
});

// Port configuration
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  logger.info(chalk.cyan.bold(`Server is running on port ${PORT}`));
});


