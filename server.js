const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// 提供静态文件（可选，如果您想同时托管前端）
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// 存储房间信息
const rooms = new Map();

// 根路由
app.get('/', (req, res) => {
  res.json({ 
    message: 'WebRTC信令服务器正在运行',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// 健康检查端点
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    rooms: rooms.size,
    timestamp: new Date().toISOString()
  });
});

// 获取房间信息
app.get('/rooms', (req, res) => {
  const roomList = Array.from(rooms.entries()).map(([roomId, room]) => ({
    roomId,
    userCount: room.users.length,
    users: room.users
  }));
  
  res.json({
    totalRooms: rooms.size,
    rooms: roomList
  });
});

// Socket.io连接处理
io.on('connection', (socket) => {
  console.log('用户连接:', socket.id);
  
  // 发送欢迎消息
  socket.emit('welcome', { 
    message: '已连接到信令服务器',
    yourId: socket.id
  });
  
  // 加入房间
  socket.on('join-room', (roomId) => {
    // 验证房间ID
    if (!roomId || typeof roomId !== 'string') {
      socket.emit('error', { message: '无效的房间ID' });
      return;
    }
    
    // 离开之前的房间
    if (socket.roomId) {
      socket.leave(socket.roomId);
      const previousRoom = rooms.get(socket.roomId);
      if (previousRoom) {
        previousRoom.users = previousRoom.users.filter(userId => userId !== socket.id);
        if (previousRoom.users.length === 0) {
          rooms.delete(socket.roomId);
        } else {
          // 通知房间内其他用户
          socket.to(socket.roomId).emit('user-left', socket.id);
          io.to(socket.roomId).emit('user-count', previousRoom.users.length);
        }
      }
    }
    
    // 加入新房间
    socket.join(roomId);
    socket.roomId = roomId;
    
    // 更新房间信息
    if (!rooms.has(roomId)) {
      rooms.set(roomId, { users: [] });
    }
    const room = rooms.get(roomId);
    room.users.push(socket.id);
    
    // 通知房间内其他用户
    socket.to(roomId).emit('user-joined', socket.id);
    io.to(roomId).emit('user-count', room.users.length);
    
    console.log(`用户 ${socket.id} 加入房间 ${roomId}`);
    socket.emit('room-joined', { 
      roomId,
      userCount: room.users.length
    });
  });
  
  // 处理通话邀请
  socket.on('offer', (data) => {
    if (!socket.roomId) {
      socket.emit('error', { message: '请先加入房间' });
      return;
    }
    
    socket.to(data.to).emit('offer', {
      offer: data.offer,
      from: socket.id
    });
  });
  
  // 处理应答
  socket.on('answer', (data) => {
    if (!socket.roomId) {
      socket.emit('error', { message: '请先加入房间' });
      return;
    }
    
    socket.to(data.to).emit('answer', {
      answer: data.answer,
      from: socket.id
    });
  });
  
  // 处理ICE候选
  socket.on('ice-candidate', (data) => {
    if (!socket.roomId) {
      socket.emit('error', { message: '请先加入房间' });
      return;
    }
    
    socket.to(data.to).emit('ice-candidate', {
      candidate: data.candidate,
      from: socket.id
    });
  });
  
  // 发送消息
  socket.on('send-message', (data) => {
    if (!socket.roomId) {
      socket.emit('error', { message: '请先加入房间' });
      return;
    }
    
    io.to(socket.roomId).emit('new-message', {
      from: socket.id,
      message: data.message,
      timestamp: new Date().toISOString()
    });
  });
  
  // 断开连接
  socket.on('disconnect', (reason) => {
    console.log('用户断开连接:', socket.id, '原因:', reason);
    
    if (socket.roomId) {
      const room = rooms.get(socket.roomId);
      if (room) {
        room.users = room.users.filter(userId => userId !== socket.id);
        if (room.users.length === 0) {
          rooms.delete(socket.roomId);
        } else {
          // 通知房间内其他用户
          socket.to(socket.roomId).emit('user-left', socket.id);
          io.to(socket.roomId).emit('user-count', room.users.length);
        }
      }
    }
  });
  
  // 错误处理
  socket.on('error', (error) => {
    console.error('Socket错误:', error);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`信令服务器运行在端口 ${PORT}`);
  console.log(`环境: ${process.env.NODE_ENV || 'development'}`);
});
