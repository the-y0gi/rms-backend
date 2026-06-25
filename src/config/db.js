const mongoose = require('mongoose');
const chalk = require('chalk');
const logger = require('../shared/utils/logger');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI);
    logger.info(chalk.green.bold(`MongoDB Connected: ${conn.connection.host}`));
  } catch (error) {
    logger.error(chalk.red.bold(`Database connection error: ${error.message}`));
    process.exit(1);
  }
};

module.exports = connectDB;

