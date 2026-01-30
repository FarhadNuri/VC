const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();

const MAX_USERS_PER_ROOM = 5;
const ROOM_CODE_LENGTH = 5;
const ROOM_CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function generateRoomCode() {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_CHARS.charAt(Math.floor(Math.random() * ROOM_CODE_CHARS.length));
  }
  return code;
}

function generateUniqueRoomCode() {
  let code;
  let attempts = 0;
  do {
    code = generateRoomCode();
    attempts++;
    if (attempts > 100) {
      throw new Error('Unable to generate unique room code');
    }
  } while (rooms.has(code));
  return code;
}

function getNextUserId(room) {
  const existingIds = Object.values(room.users).map(u => {
    const match = u.userId.match(/User-(\d+)/);
    return match ? parseInt(match[1]) : 0;
  });
  const maxId = existingIds.length > 0 ? Math.max(...existingIds) : 0;
  return `User-${maxId + 1}`;
}

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);
  
  let currentRoom = null;
  let currentUserId = null;

  socket.on('create-room', (callback) => {
    try {
      const roomCode = generateUniqueRoomCode();
      const userId = 'User-1';
      
      rooms.set(roomCode, {
        roomCode,
        users: {
          [socket.id]: { userId }
        },
        createdAt: Date.now()
      });
      
      currentRoom = roomCode;
      currentUserId = userId;
      socket.join(roomCode);
      
      console.log(`Room created: ${roomCode} by ${userId}`);
      
      callback({
        success: true,
        roomCode,
        userId
      });
    } catch (error) {
      callback({
        success: false,
        error: 'Failed to create room'
      });
    }
  });

  socket.on('join-room', (roomCode, callback) => {
    const normalizedCode = roomCode.toUpperCase().trim();
    const room = rooms.get(normalizedCode);
    
    if (!room) {
      return callback({
        success: false,
        error: 'room-not-found'
      });
    }
    
    const userCount = Object.keys(room.users).length;
    if (userCount >= MAX_USERS_PER_ROOM) {
      return callback({
        success: false,
        error: 'room-full'
      });
    }
    
    const userId = getNextUserId(room);
    room.users[socket.id] = { userId };
    
    currentRoom = normalizedCode;
    currentUserId = userId;
    socket.join(normalizedCode);
    
    socket.to(normalizedCode).emit('user-joined', {
      socketId: socket.id,
      userId
    });
    
    const existingUsers = Object.entries(room.users)
      .filter(([sid]) => sid !== socket.id)
      .map(([socketId, user]) => ({
        socketId,
        userId: user.userId
      }));
    
    console.log(`User ${userId} joined room: ${normalizedCode}`);
    
    callback({
      success: true,
      roomCode: normalizedCode,
      userId,
      existingUsers
    });
  });

  socket.on('leave-room', () => {
    handleLeaveRoom();
  });

  socket.on('offer', ({ targetSocketId, offer }) => {
    if (!currentRoom) return;
    socket.to(targetSocketId).emit('offer', {
      senderSocketId: socket.id,
      offer
    });
  });

  socket.on('answer', ({ targetSocketId, answer }) => {
    if (!currentRoom) return;
    socket.to(targetSocketId).emit('answer', {
      senderSocketId: socket.id,
      answer
    });
  });

  socket.on('ice-candidate', ({ targetSocketId, candidate }) => {
    if (!currentRoom) return;
    socket.to(targetSocketId).emit('ice-candidate', {
      senderSocketId: socket.id,
      candidate
    });
  });

  socket.on('send-message', (message) => {
    if (!currentRoom || !message || typeof message !== 'string') return;
    
    const sanitizedMessage = message.trim().slice(0, 500);
    if (!sanitizedMessage) return;
    
    io.to(currentRoom).emit('receive-message', {
      userId: currentUserId,
      message: sanitizedMessage
    });
  });

  function handleLeaveRoom() {
    if (!currentRoom) return;
    
    const room = rooms.get(currentRoom);
    if (room) {
      delete room.users[socket.id];
      
      socket.to(currentRoom).emit('user-left', {
        socketId: socket.id,
        userId: currentUserId
      });
      
      if (Object.keys(room.users).length === 0) {
        rooms.delete(currentRoom);
        console.log(`Room destroyed: ${currentRoom}`);
      }
      
      console.log(`User ${currentUserId} left room: ${currentRoom}`);
    }
    
    socket.leave(currentRoom);
    currentRoom = null;
    currentUserId = null;
  }

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    handleLeaveRoom();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser`);
});
