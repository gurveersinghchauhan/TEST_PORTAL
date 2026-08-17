const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { initSocketHandler } = require('./socketHandler');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' },
});

initSocketHandler(io);

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Socket server listening on :${PORT}`));