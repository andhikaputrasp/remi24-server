import { Server, Socket } from 'socket.io';
import { GameState } from './GameState';

export class RoomManager {
    private rooms: Map<string, GameState> = new Map();
    private io: Server;

    constructor(io: Server) {
        this.io = io;
    }

    createRoom(socket: Socket, playerName: string, maxPlayers: number, roundTimeLimit: number = 60, maxRounds: number = 10) {
        // Generate a random 4-char alphanumeric room code
        const roomId = Math.random().toString(36).substring(2, 6).toUpperCase();

        // Ensure 60/90/120 are respected
        const allowedTimes = [60, 90, 120];
        const time = allowedTimes.includes(roundTimeLimit) ? roundTimeLimit : 60;

        const maxP = [4, 8, 12].includes(maxPlayers) ? maxPlayers : 4;
        const maxR = [10, 20].includes(maxRounds) ? maxRounds : 10;

        const gameState = new GameState(roomId, socket.id, maxP, time, maxR, this.io);
        this.rooms.set(roomId, gameState);

        socket.join(roomId);
        gameState.addPlayer(socket.id, playerName);

        return gameState;
    }

    joinRoom(socket: Socket, roomId: string, playerName: string) {
        const room = this.rooms.get(roomId.toUpperCase());
        if (!room) {
            throw new Error("Room not found");
        }

        socket.join(room.id);
        room.addPlayer(socket.id, playerName);
        return room;
    }

    startGame(socketId: string, roomId: string) {
        const room = this.rooms.get(roomId);
        if (room) {
            room.startGame(socketId);
        }
    }

    updateSettings(socketId: string, roomId: string, maxPlayers: number, roundTimeLimit: number, maxRounds: number) {
        const room = this.rooms.get(roomId);
        if (room && room.host === socketId) {
            const maxP = [4, 8, 12].includes(maxPlayers) ? maxPlayers : 4;
            const time = [60, 90, 120].includes(roundTimeLimit) ? roundTimeLimit : 60;
            const maxR = [10, 20].includes(maxRounds) ? maxRounds : 10;
            room.updateSettings(maxP, time, maxR);
        }
    }

    kickPlayer(socketId: string, roomId: string, targetSocketId: string) {
        const room = this.rooms.get(roomId);
        if (room && room.host === socketId && socketId !== targetSocketId) {
            room.kickPlayer(targetSocketId);
            this.io.to(targetSocketId).emit('kicked_from_room');
            this.io.sockets.sockets.get(targetSocketId)?.leave(roomId);
        }
    }

    getRoom(roomId: string) {
        return this.rooms.get(roomId.toUpperCase());
    }

    submitAnswer(socketId: string, roomId: string, expression: string) {
        const room = this.rooms.get(roomId);
        if (room) {
            room.submitAnswer(socketId, expression);
        }
    }

    voteShuffle(socketId: string, roomId: string) {
        const room = this.rooms.get(roomId);
        if (room) {
            room.voteShuffle(socketId);
        }
    }

    sendChat(socketId: string, roomId: string, message: string) {
        const room = this.rooms.get(roomId);
        if (room) {
            room.sendChat(socketId, message);
        }
    }

    updateColor(socketId: string, roomId: string, color: string) {
        const room = this.rooms.get(roomId);
        if (room) {
            room.updateColor(socketId, color);
        }
    }

    leaveRoom(socketId: string, roomId: string) {
        const room = this.rooms.get(roomId.toUpperCase());
        if (room) {
            room.removePlayer(socketId);
            this.handlePlayerLeave(room, socketId);
            this.io.sockets.sockets.get(socketId)?.leave(roomId);
        }
    }

    handleDisconnect(socketId: string) {
        for (const [roomId, room] of this.rooms.entries()) {
            const player = room.players.find(p => p.socketId === socketId);
            if (player) {
                room.disconnectPlayer(socketId, (timeoutSocketId) => {
                    // This callback fires after 10 seconds if they don't reconnect
                    room.removePlayer(timeoutSocketId);
                    this.handlePlayerLeave(room, timeoutSocketId);

                    // Cleanup room if empty
                    const hasActivePlayers = room.players.some(p => p.isConnected);
                    if (!hasActivePlayers) {
                        this.rooms.delete(room.id);
                    }
                });

                // Immediately handle host reassignment if the host disconnects,
                // but keep the room alive for 10s if the host is the last player
                if (room.host === socketId) {
                    const nextPlayer = room.players.find(p => p.isConnected);
                    if (nextPlayer) {
                        room.host = nextPlayer.socketId;
                        room.emitState();
                    }
                }
            }
        }
    }

    private handlePlayerLeave(room: GameState, socketId: string) {
        // If room is empty, delete it
        const hasActivePlayers = room.players.some(p => p.isConnected);
        if (!hasActivePlayers) {
            this.rooms.delete(room.id);
        } else if (room.host === socketId) {
            // Dynamic Hosting: Reassign host to the next active player
            const nextPlayer = room.players.find(p => p.isConnected);
            if (nextPlayer) {
                room.host = nextPlayer.socketId;
                room.emitState();
            }
        }
    }
}
