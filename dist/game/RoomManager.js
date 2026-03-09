"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RoomManager = void 0;
const GameState_1 = require("./GameState");
class RoomManager {
    constructor(io) {
        this.rooms = new Map();
        this.io = io;
    }
    createRoom(socket, playerName, maxPlayers, roundTimeLimit = 60) {
        // Generate a random 4-char alphanumeric room code
        const roomId = Math.random().toString(36).substring(2, 6).toUpperCase();
        // Ensure 60/90/120 are respected
        const allowedTimes = [60, 90, 120];
        const time = allowedTimes.includes(roundTimeLimit) ? roundTimeLimit : 60;
        const maxP = [4, 8, 12].includes(maxPlayers) ? maxPlayers : 4;
        const gameState = new GameState_1.GameState(roomId, socket.id, maxP, time, this.io);
        this.rooms.set(roomId, gameState);
        socket.join(roomId);
        gameState.addPlayer(socket.id, playerName);
        return gameState;
    }
    joinRoom(socket, roomId, playerName) {
        const room = this.rooms.get(roomId.toUpperCase());
        if (!room) {
            throw new Error("Room not found");
        }
        socket.join(room.id);
        room.addPlayer(socket.id, playerName);
        return room;
    }
    startGame(socketId, roomId) {
        const room = this.rooms.get(roomId);
        if (room) {
            room.startGame(socketId);
        }
    }
    getRoom(roomId) {
        return this.rooms.get(roomId.toUpperCase());
    }
    submitAnswer(socketId, roomId, expression) {
        const room = this.rooms.get(roomId);
        if (room) {
            room.submitAnswer(socketId, expression);
        }
    }
    voteShuffle(socketId, roomId) {
        const room = this.rooms.get(roomId);
        if (room) {
            room.voteShuffle(socketId);
        }
    }
    handleDisconnect(socketId) {
        for (const [roomId, room] of this.rooms.entries()) {
            const player = room.players.find(p => p.socketId === socketId);
            if (player) {
                room.removePlayer(socketId);
                // If room is empty, delete it
                const hasActivePlayers = room.players.some(p => p.isConnected);
                if (!hasActivePlayers) {
                    this.rooms.delete(roomId);
                }
                else if (room.host === socketId && room.status === 'waiting') {
                    // If host leaves in waiting state, maybe assign new host?
                    const nextPlayer = room.players.find(p => p.isConnected);
                    if (nextPlayer) {
                        room.host = nextPlayer.socketId;
                        room.emitState();
                    }
                }
            }
        }
    }
}
exports.RoomManager = RoomManager;
