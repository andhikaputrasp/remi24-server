import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { RoomManager } from './game/RoomManager';

dotenv.config();

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

const roomManager = new RoomManager(io);

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('create_room', (data, callback) => {
        try {
            const { playerName, maxPlayers, roundTime, maxRounds } = data;
            const room = roomManager.createRoom(socket, playerName, maxPlayers, roundTime, maxRounds);
            callback({ success: true, roomId: room.id });
        } catch (err: any) {
            callback({ success: false, message: err.message });
        }
    });

    socket.on('join_room', (data, callback) => {
        try {
            const { roomId, playerName } = data;
            const room = roomManager.joinRoom(socket, roomId, playerName);
            callback({ success: true, roomId: room.id });
        } catch (err: any) {
            console.error("Join room error:", err.message);
            callback({ success: false, message: err.message });
        }
    });

    socket.on('start_game', (roomId) => {
        roomManager.startGame(socket.id, roomId);
    });

    socket.on('get_state', (roomId) => {
        if (!roomId) return;
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

    socket.on('send_chat', (data) => {
        const { roomId, message } = data;
        roomManager.sendChat(socket.id, roomId, message);
    });

    socket.on('update_settings', (data) => {
        const { roomId, maxPlayers, roundTime, maxRounds } = data;
        roomManager.updateSettings(socket.id, roomId, maxPlayers, roundTime, maxRounds);
    });

    socket.on('update_color', (data) => {
        const { roomId, color } = data;
        roomManager.updateColor(socket.id, roomId, color);
    });

    socket.on('kick_player', (data) => {
        const { roomId, targetId } = data;
        roomManager.kickPlayer(socket.id, roomId, targetId);
    });

    socket.on('leave_room', (roomId) => {
        if (!roomId) return;
        roomManager.leaveRoom(socket.id, roomId);
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
