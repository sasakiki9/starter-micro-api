'use strict';

const http = require('http');
const urlParse = require('url').parse;
const WebSocketServer = require('ws').Server;

let msgIndex = 0;

const MSG = {
  BUTTON_DOWN: ++msgIndex,
  BUTTON_UP: ++msgIndex,
  PLAY: ++msgIndex,
  PAUSE: ++msgIndex,
  MUTE: ++msgIndex,
  UNMUTE: ++msgIndex,
  RELOAD: ++msgIndex,
  CLOSE: ++msgIndex,
  LOAD_FILE: ++msgIndex,
  FILE_LOADED: ++msgIndex,
  REMOTE_CONNECTED: ++msgIndex,
  REMOTE_DISCONNECTED: ++msgIndex,
  CONNECTED: ++msgIndex,
  FRAME: ++msgIndex,
};

const PLAYERS_PER_ROOM = 2;
const MAX_ROOMS = 256;
const FRAME_RATE = 50;

let rooms = {};

class Room {
  constructor(opts) {
    this.id = opts.id;
    this.players = {};
    this.numPlayers = 0;
    this.frameTimer = null;
  }

  newPlayerId() {
    for (let id = 1; id <= PLAYERS_PER_ROOM; id++) {
      if (!this.players.hasOwnProperty(id)) return id;
    }
    return false;
  }

  arePlayersReady() {
    for (let id in this.players) {
      if (!this.players[id].ready) return false;
    }
    return true;
  }

  addPlayer(player) {
    if (this.players.hasOwnProperty(player.id)) return;
    this.stop();
    this.broadcast(MSG.REMOTE_CONNECTED, player.id);
    this.players[player.id] = player;
    this.numPlayers++;
    player.send(MSG.CONNECTED, this.id, player.id);
  }

  removePlayer(player) {
    if (!this.players.hasOwnProperty(player.id)) return;
    delete this.players[player.id];
    this.numPlayers--;
    this.stop();
    this.broadcast(MSG.REMOTE_DISCONNECTED, player.id);
  }

  broadcast(msg, ...args) {
    for (let id in this.players) {
      this.players[id].send(msg, ...args);
    }
  }

  start(frameRate) {
    if (this.frameTimer) return;
    if (!this.arePlayersReady()) return;
    frameRate = Number(frameRate);
    if (!frameRate) frameRate = FRAME_RATE;
    if (frameRate < 1) frameRate = 1;
    if (frameRate > 100) frameRate = 100;
    this.frameTimer = setInterval(this.sendFrame.bind(this), 1000 / frameRate);
    this.broadcast(MSG.PLAY);
  }

  stop() {
    if (!this.frameTimer) return;
    clearInterval(this.frameTimer);
    this.frameTimer = null;
    this.broadcast(MSG.PAUSE);
  }

  sendFrame() {
    this.broadcast(MSG.FRAME);
  }

  loadFile(fileId) {
    this.stop();
    for (let id in this.players) {
      this.players[id].ready = false;
    }
    this.broadcast(MSG.LOAD_FILE, fileId);
  }

  onFileLoaded(fileId, playerId) {
    if (!this.players.hasOwnProperty(playerId)) return;
    this.players[playerId].ready = true;
  }
}

class Player {
  constructor(opts) {
    this.id = opts.id;
    this.socket = opts.socket;
    this.ready = false;
  }

  send(msg, ...args) {
    args.unshift(msg);
    this.socket.send(args.toString());
  }
}

function getParams(socket, req) {
  req || (req = socket.upgradeReq);
  return urlParse(req.url, true).query;
}

function findRoom(roomId) {
  if (!rooms.hasOwnProperty(roomId)) {
    return false;
  }
  let room = rooms[roomId];
  if (room.numPlayers >= PLAYERS_PER_ROOM) {
    return false;
  }
  return room;
}

function findEmptyRoom() {
  let room;
  for (let id in rooms) {
    room = rooms[id];
    if (room.numPlayers === 0) {
      return room;
    }
  }
  return createRoom();
}

function createRoom() {
  let numRooms = Object.keys(rooms).length;
  if (numRooms >= MAX_ROOMS) {
    return false;
  }
  let room = new Room({id: numRooms + 1});
  rooms[room.id] = room;
  return room;
}

function precreateRooms(num) {
  for (let i = 0; i < num; i++) {
    createRoom();
  }
}


let httpServer = http.createServer((req, res) => {
  res.end();
});

let server = new WebSocketServer({
  server: httpServer,
  perMessageDeflate: false,
});

server.on('connection', (socket, req) => {
  let room, player;

  socket.on('error', () => {
    if (player) {
      room.removePlayer(player);
    }
  });

  let params = getParams(socket, req);
  if (!params) {
    socket.close();
    return;
  }

  let roomId = Number(params['room']);
  if (roomId) {
    room = findRoom(roomId);
  } else {
    room = findEmptyRoom();
  }

  if (!room) {
    socket.close();
    return;
  }

  player = new Player({id: room.newPlayerId(), socket: socket});
  room.addPlayer(player);

  socket.on('message', (data) => {
    let args = data.toString().split(",").map(Number);
    let msg = args.shift();
    switch(msg) {
      case MSG.PLAY:
        room.start(args[0]);
        break;
      case MSG.PAUSE:
        room.stop();
        break;
      case MSG.BUTTON_DOWN:
        room.broadcast(MSG.BUTTON_DOWN, args[0], args[1]);
        break;
      case MSG.BUTTON_UP:
        room.broadcast(MSG.BUTTON_UP, args[0], args[1]);
        break;
      case MSG.LOAD_FILE:
        room.loadFile(args[0]);
        break;
      case MSG.FILE_LOADED:
        room.onFileLoaded(args[0], player.id);
        break;
      case MSG.RELOAD:
        room.stop();
        room.broadcast(MSG.RELOAD);
        break;
      case MSG.CLOSE:
        room.stop();
        room.broadcast(MSG.CLOSE);
        break;
      case MSG.MUTE:
        room.broadcast(MSG.MUTE);
        break;
      case MSG.UNMUTE:
        room.broadcast(MSG.UNMUTE);
        break;
    }
  });

  socket.on('close', () => {
    room.removePlayer(player);
  });
});

precreateRooms(64);
httpServer.listen(+process.env.PORT || 3000);
