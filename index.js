'use strict';

const http = require('http');
const urlParse = require('url').parse;
const WebSocketServer = require('ws').Server;

const PLAYERS_PER_ROOM = 2;
const MAX_ROOMS = 256;

const MSG = {
  PLAYER_CONNECTED: 1,
  PLAYER_DISCONNECTED: 2,
  PLAYER_READY: 3,
  ROOM_CREATED: 4,
  BUTTON_DOWN: 5,
  BUTTON_UP: 6,
  FRAME: 7,
  PLAY: 8,
  PAUSE: 9,
  RELOAD: 10,
  OPEN: 11,
  CLOSE: 12,
};

let rooms = {};

class Room {
  constructor(opts) {
    this.id = opts.id;
    this.players = {};
    this.numPlayers = 0;
  }

  addPlayer(player) {
    if (this.players.hasOwnProperty(player.id)) return;
    this.players[player.id] = player;
    this.numPlayers++;
  }

  removePlayer(player) {
    if (!this.players.hasOwnProperty(player.id)) return;
    delete this.players[player.id];
    this.numPlayers--;
  }

  broadcast(msg, ...args) {
    for (let id in this.players) {
      this.players[id].sendMessage(msg, ...args);
    }
  }

  broadcastExcept(exceptPlayer, msg, ...args) {
    for (let id in this.players) {
      if (id !== exceptPlayer.id) {
        this.players[id].sendMessage(msg, ...args);
      }
    }
  }
}

class Player {
  constructor(opts) {
    this.id = opts.id;
    this.socket = opts.socket;
  }

  sendMessage(msg, ...args) {
    args.unshift(msg);
    this.socket.send(args.toString());
  }
}

function getParams(req) {
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
  path: '/',
  disableHixie: true,
  clientTracking: false,
  perMessageDeflate: false,
});

server.on('connection', (socket) => {
  let room, player;

  socket.on('error', () => {
    if (player) {
      //
    }
  });

  let params = getParams(socket.upgradeReq);
  if (!params) {
    socket.close();
    return;
  }

  let roomId = Number(params['room']);
  if (roomId) {
    room = findRoom(roomId);
    if (!room) {
      socket.close();
      return;
    }

    player = new Player({id: room.numPlayers + 1, socket: socket});
    room.addPlayer(player);

    room.broadcast(MSG.PLAYER_CONNECTED);
  } else {
    room = findEmptyRoom();
    if (!room) {
      socket.close();
      return;
    }

    player = new Player({id: 1, socket: socket});
    room.addPlayer(player);

    player.sendMessage(MSG.ROOM_CREATED, room.id);
  }

  socket.on('message', (data) => {
    let args = data.split(",").map(Number);
    let msg = args.shift();
    switch(msg) {
      case MSG.BUTTON_DOWN:
      case MSG.BUTTON_UP:
        room.broadcast(msg, args[0], args[1]);
        break;
      case MSG.FRAME:
      case MSG.PLAY:
      case MSG.PAUSE:
      case MSG.RELOAD:
      case MSG.CLOSE:
        room.broadcast(msg);
        break;
      case MSG.OPEN:
        room.broadcast(msg, args[0]);
        break;
      case MSG.PLAYER_READY:
        room.broadcastExcept(player, msg, args[0]);
        break;
    }
  });

  socket.on('close', () => {
    room.removePlayer(player);
    room.broadcast(MSG.PLAYER_DISCONNECTED);
  });
});

precreateRooms(64);
httpServer.listen(+process.env.PORT || 3000);
