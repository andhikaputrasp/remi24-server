"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const socket_io_1 = require("socket.io");
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const RoomManager_1 = require("./game/RoomManager");
dotenv_1.default.config();
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
const server = http_1.default.createServer(app);
const io = new socket_io_1.Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});
const roomManager = new RoomManager_1.RoomManager(io);
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);
    socket.on('create_room', (data, callback) => {
        try {
            const { playerName, maxPlayers, roundTime } = data;
            const room = roomManager.createRoom(socket, playerName, maxPlayers, roundTime);
            callback({ success: true, roomId: room.id });
        }
        catch (err) {
            callback({ success: false, message: err.message });
        }
    });
    socket.on('join_room', (data, callback) => {
        try {
            const { roomId, playerName } = data;
            const room = roomManager.joinRoom(socket, roomId, playerName);
            callback({ success: true, roomId: room.id });
        }
        catch (err) {
            callback({ success: false, message: err.message });
        }
    });
    socket.on('start_game', (roomId) => {
        roomManager.startGame(socket.id, roomId);
    });
    socket.on('get_state', (roomId) => {
        if (!roomId)
            return;
        const room = roomManager.getRoom(roomId);
        if (room) {
            // Emit state directly back to the requester
            socket.emit('state_update', {
                id: room.id,
                host: room.host,
                maxPlayers: room.maxPlayers,
                status: room.status,
                players: room.players,
                currentCards: room.currentCards,
                cardsLeft: room.deck.length,
                currentRound: room.currentRound
            });
        }
    });
    socket.on('submit_answer', (data) => {
        const { roomId, expression } = data;
        roomManager.submitAnswer(socket.id, roomId, expression);
    });
    socket.on('vote_shuffle', (roomId) => {
        roomManager.voteShuffle(socket.id, roomId);
    });
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        roomManager.handleDisconnect(socket.id);
    });
});
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
