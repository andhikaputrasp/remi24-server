import { Server } from 'socket.io';
import { generateDeck, Card } from './deck';
import { evaluate24 } from './gameLogic';

export interface Player {
    socketId: string;
    name: string;
    points: number;
    roundPoints: number; // Points gained in current round
    isConnected: boolean;
    hasAnswered: boolean;
    answerTime: number | null; // time taken in MS
    roundAnswer: string | null;
    attempts: number; // Max 3 per round
    isSpectator: boolean;
    color: string;
    lastChatTime: number;
}

export class GameState {
    id: string;
    host: string;
    maxPlayers: number;
    roundTimeLimit: number; // in seconds
    maxRounds: number;
    status: 'waiting' | 'playing' | 'leaderboard' | 'finished';
    players: Player[] = [];
    deck: Card[] = [];
    currentCards: Card[] = [];
    roundStartTime: number = 0;
    roundTimer: NodeJS.Timeout | null = null;
    votesToShuffle: Set<string> = new Set();
    io: Server;
    currentRound: number = 0;
    lastGlobalChatTime: number = 0;
    firstCorrectAnswerer: string | null = null;

    // Store timeouts here, rather than on the Player object which is serialized to the client
    private disconnectTimeouts: Map<string, NodeJS.Timeout> = new Map();

    constructor(id: string, hostSocketId: string, maxPlayers: number, roundTimeLimit: number, maxRounds: number, io: Server) {
        this.id = id;
        this.host = hostSocketId;
        this.maxPlayers = maxPlayers;
        this.roundTimeLimit = roundTimeLimit;
        this.maxRounds = maxRounds;
        this.status = 'waiting';
        this.io = io;
    }

    updateSettings(maxPlayers: number, roundTimeLimit: number, maxRounds: number) {
        if (this.status !== 'waiting') return;
        this.maxPlayers = maxPlayers;
        this.roundTimeLimit = roundTimeLimit;
        this.maxRounds = maxRounds;
        this.emitState();
    }

    kickPlayer(socketId: string) {
        if (this.status !== 'waiting') return;
        const pIndex = this.players.findIndex(p => p.socketId === socketId);
        if (pIndex !== -1) {
            this.removePlayer(socketId);
        }
    }

    updateColor(socketId: string, color: string) {
        if (this.status !== 'waiting') return;
        const player = this.players.find(p => p.socketId === socketId);
        if (player) {
            player.color = color;
            this.emitState();
        }
    }

    disconnectPlayer(socketId: string, onRemove: (socketId: string) => void) {
        const player = this.players.find(p => p.socketId === socketId);
        if (player) {
            player.isConnected = false;

            // Allow 10 seconds to reconnect
            const timeout = setTimeout(() => {
                onRemove(socketId);
            }, 10000);
            this.disconnectTimeouts.set(player.name, timeout);

            this.emitState();
        }
    }

    addPlayer(socketId: string, name: string) {
        const existingPlayer = this.players.find(p => p.name === name);

        if (existingPlayer) {
            if (existingPlayer.isConnected) {
                throw new Error("A player with that name is already in this room.");
            } else {
                // Reconnect flow
                const existingTimeout = this.disconnectTimeouts.get(existingPlayer.name);
                if (existingTimeout) {
                    clearTimeout(existingTimeout);
                    this.disconnectTimeouts.delete(existingPlayer.name);
                }
                existingPlayer.socketId = socketId;
                existingPlayer.isConnected = true;

                // If game is playing, they must be spectator for the round
                if (this.status === 'playing') {
                    existingPlayer.isSpectator = true;
                }

                this.emitState();
                return;
            }
        }

        // New player flow
        const activePlayersCount = this.players.filter(p => !p.isSpectator).length;
        const isGameInProgress = this.status !== 'waiting' && this.status !== 'finished';
        const isFull = activePlayersCount >= this.maxPlayers;

        // If room is full or game started, they join as spectator
        const isSpectator = isGameInProgress || isFull;

        const defaultColors = [
            'from-indigo-400 to-purple-500',
            'from-emerald-400 to-teal-500',
            'from-rose-400 to-rose-600',
            'from-amber-400 to-orange-500',
            'from-sky-400 to-blue-500',
            'from-fuchsia-400 to-pink-500'
        ];
        const randomColor = defaultColors[Math.floor(Math.random() * defaultColors.length)];

        this.players.push({
            socketId,
            name,
            points: 0,
            roundPoints: 0,
            isConnected: true,
            hasAnswered: false,
            answerTime: null,
            roundAnswer: null,
            attempts: 0,
            isSpectator,
            color: randomColor,
            lastChatTime: 0
        });
        this.emitState();
    }

    removePlayer(socketId: string) {
        const playerIndex = this.players.findIndex(p => p.socketId === socketId);
        if (playerIndex !== -1) {
            const player = this.players[playerIndex];
            const timeout = this.disconnectTimeouts.get(player.name);
            if (timeout) {
                clearTimeout(timeout);
                this.disconnectTimeouts.delete(player.name);
            }

            this.players.splice(playerIndex, 1);

            if (this.votesToShuffle.has(socketId)) {
                this.votesToShuffle.delete(socketId);
            }

            if (this.status === 'playing') {
                this.checkRoundEndCondition();
            }

            this.emitState();
        }
    }

    startGame(socketId: string) {
        if (socketId !== this.host) {
            throw new Error("Only host can start the game");
        }
        if (this.players.length < 2) {
            // throw new Error("Need at least 2 players");
            // Allowing 1 player for easy testing if needed, but normally >1
        }

        // Reset scores if it was finished
        if (this.status === 'finished' || this.status === 'waiting') {
            this.players.forEach(p => p.points = 0);
            this.deck = generateDeck();
            this.currentRound = 0;
        }

        this.startNextRound();
    }

    startNextRound() {
        if (this.deck.length < 4) {
            this.endGame();
            return;
        }

        this.status = 'playing';
        this.currentRound++;
        this.currentCards = this.deck.splice(0, 4);
        this.votesToShuffle.clear();
        this.firstCorrectAnswerer = null;

        // Promote spectators if there is room
        let activeCount = this.players.filter(p => p.isConnected && !p.isSpectator).length;

        // We iterate and try to promote those who are marked as spectators but are still connected.
        // We also want to make sure reconnected players regain active status
        this.players.forEach(p => {
            if (p.isSpectator && p.isConnected && activeCount < this.maxPlayers) {
                p.isSpectator = false;
                activeCount++;
            }
        });

        this.players.forEach(p => {
            p.hasAnswered = false;
            p.answerTime = null;
            p.roundAnswer = null;
            p.attempts = 0;
            p.roundPoints = 0; // Reset round points
        });

        this.roundStartTime = Date.now() + 3000;

        if (this.roundTimer) clearInterval(this.roundTimer);

        // Initial warmup emit
        this.io.to(this.id).emit('warmup_tick', 3);

        this.roundTimer = setInterval(() => {
            const now = Date.now();
            if (now < this.roundStartTime) {
                const warmupLeft = Math.ceil((this.roundStartTime - now) / 1000);
                if (warmupLeft > 0) {
                    this.io.to(this.id).emit('warmup_tick', warmupLeft);
                }
            } else {
                const elapsed = Math.floor((now - this.roundStartTime) / 1000);
                const left = this.roundTimeLimit - elapsed;

                if (left <= 0) {
                    if (this.roundTimer) clearInterval(this.roundTimer);
                    this.roundTimer = null;
                    this.endRound();
                } else {
                    this.io.to(this.id).emit('time_tick', left);
                }
            }
        }, 1000);

        this.emitState();
    }

    submitAnswer(socketId: string, expression: string) {
        if (this.status !== 'playing') return;

        const player = this.players.find(p => p.socketId === socketId);
        if (!player || player.isSpectator || player.hasAnswered || player.attempts >= 3) return;

        // Automatically reject invalid inputs to prevent crash or logic exploit
        if (!/^[0-9+\-*/() ]+$/.test(expression)) {
            this.io.to(socketId).emit('answer_result', { success: false, message: 'Invalid format' });
            return;
        }

        player.attempts++;

        // Validate if expression uses exactly the 4 current cards
        const numbersUsed = expression.match(/\d+/g)?.map(Number) || [];
        const _sortedCurrent = [...this.currentCards].map(c => c.value).sort();
        const _sortedUsed = [...numbersUsed].sort();

        // Check lengths and exact values
        if (_sortedCurrent.length !== _sortedUsed.length || !_sortedCurrent.every((val, index) => val === _sortedUsed[index])) {
            this.io.to(socketId).emit('answer_result', { success: false, message: 'Invalid cards used, must use exactly the 4 current cards' });
            return;
        }

        if (evaluate24(expression)) {
            player.hasAnswered = true;
            player.answerTime = Date.now() - this.roundStartTime;
            player.roundAnswer = expression;

            const elapsedSecs = Math.floor(player.answerTime / 1000);
            let basePts = 0;

            if (this.roundTimeLimit === 60) {
                if (elapsedSecs <= 20) basePts = 20;
                else if (elapsedSecs <= 40) basePts = 15;
                else basePts = 10;
            } else if (this.roundTimeLimit === 90) {
                if (elapsedSecs <= 30) basePts = 20;
                else if (elapsedSecs <= 60) basePts = 15;
                else basePts = 10;
            } else {
                if (elapsedSecs <= 40) basePts = 20;
                else if (elapsedSecs <= 80) basePts = 15;
                else basePts = 10;
            }

            let bonus = 0;
            if (!this.firstCorrectAnswerer) {
                this.firstCorrectAnswerer = socketId;
                bonus = 5;
            }

            const earned = basePts + bonus;
            player.points += earned;
            player.roundPoints += earned;

            this.io.to(socketId).emit('answer_result', { success: true, message: 'Correct!' });

            // Ensure we broadcast the new state so clients update the 'Jawab' button and 'Answered' tags
            this.emitState();

            // Check if round should end (all or all but 1 answered, or all maxed out attempts)
            this.checkRoundEndCondition();
        } else {
            let penalty = 0;
            if (player.attempts === 1) penalty = 2;
            else if (player.attempts === 2) penalty = 4;
            else if (player.attempts >= 3) penalty = 5;

            player.points = Math.max(0, player.points - penalty);
            player.roundPoints -= penalty;

            this.io.to(socketId).emit('answer_result', { success: false, message: `Salah! Sisa percobaan: ${3 - player.attempts}` });
            this.checkRoundEndCondition();
            this.emitState(); // update attempt count UI
        }
    }

    checkRoundEndCondition() {
        const activePlayers = this.players.filter(p => p.isConnected && !p.isSpectator);
        const activeCount = activePlayers.length;

        const completedPlayers = activePlayers.filter(p => p.hasAnswered || p.attempts >= 3).length;
        const unansweredCount = activeCount - completedPlayers;

        const totalConnected = this.players.filter(p => p.isConnected).length;

        // If 1 or 0 people haven't finished (answered/maxed out), end the round IF there are > 1 players
        // If it's a 1-player game or active players drop to 1, end the round immediately to trigger the auto-win
        // EXCEPTION: if there are spectators waiting to join (totalConnected > 1), wait for the active player to finish.
        if (totalConnected <= 1) {
            this.endRound();
        } else if (activeCount === 0) {
            this.endRound(); // all active disconnected, but spectators waiting
        } else if (activeCount === 1) {
            if (completedPlayers === 1) this.endRound();
        } else {
            if (unansweredCount <= 1 || completedPlayers === activeCount) {
                this.endRound();
            }
        }
    }

    voteShuffle(socketId: string) {
        if (this.status !== 'playing') return;

        const player = this.players.find(p => p.socketId === socketId);
        if (!player || player.isSpectator) return;

        // If anyone has already answered correctly, shuffle is disabled
        if (this.players.some(p => p.hasAnswered && !p.isSpectator)) return;

        this.votesToShuffle.add(socketId);
        // We do not just emit count here, we update state to transmit voters array
        this.emitState();

        const activePlayers = this.players.filter(p => p.isConnected && !p.isSpectator).length;
        if (this.votesToShuffle.size >= activePlayers) {
            // Everyone voted to shuffle. Put 4 cards back to bottom of deck and draw 4 new ones.
            this.deck.push(...this.currentCards);
            if (this.deck.length >= 4) {
                this.currentCards = this.deck.splice(0, 4);
                this.votesToShuffle.clear();

                this.roundStartTime = Date.now() + 3000;
                if (this.roundTimer) clearInterval(this.roundTimer);
                this.io.to(this.id).emit('warmup_tick', 3);

                this.roundTimer = setInterval(() => {
                    const now = Date.now();
                    if (now < this.roundStartTime) {
                        const warmupLeft = Math.ceil((this.roundStartTime - now) / 1000);
                        if (warmupLeft > 0) {
                            this.io.to(this.id).emit('warmup_tick', warmupLeft);
                        }
                    } else {
                        const elapsed = Math.floor((now - this.roundStartTime) / 1000);
                        const left = this.roundTimeLimit - elapsed;

                        if (left <= 0) {
                            if (this.roundTimer) clearInterval(this.roundTimer);
                            this.roundTimer = null;
                            this.endRound();
                        } else {
                            this.io.to(this.id).emit('time_tick', left);
                        }
                    }
                }, 1000);

                this.emitState();
            }
        }
    }

    endRound() {
        if (this.status !== 'playing') return;
        this.status = 'leaderboard';
        if (this.roundTimer) {
            clearInterval(this.roundTimer);
            this.roundTimer = null;
        }

        // Active players get minus points if they didn't answer and exceeded time
        this.players.forEach(p => {
            if (!p.isSpectator && !p.hasAnswered) {
                // Determine penalty
                p.roundPoints = 0; // Or could be negative, but let's stick to simple 0 for not answering
            }
        });

        // Sort leaderboard by points
        this.players.sort((a, b) => b.points - a.points);
        this.emitState();

        this.io.to(this.id).emit('round_ended', {
            players: this.players,
            correctSequence: this.currentCards
        });

        // Loop up to maxRounds or if only 1 active player remains
        // EXCEPTION: If there are connected spectators waiting to join, continue to the next round so they can be promoted.
        const totalConnected = this.players.filter(p => p.isConnected).length;

        if (this.currentRound >= this.maxRounds || this.deck.length < 4 || totalConnected <= 1) {
            setTimeout(() => {
                this.endGame();
            }, 7000);
        } else {
            setTimeout(() => {
                this.startNextRound();
            }, 7000);
        }
    }

    sendChat(socketId: string, message: string) {
        const player = this.players.find(p => p.socketId === socketId);
        if (!player) return;

        const now = Date.now();
        // Global cooldown of 1 second
        if (now - this.lastGlobalChatTime < 1000) {
            this.io.to(socketId).emit('chat_error', { message: 'Wait 1 second before sending another message...' });
            return;
        }

        // Personal cooldown of 5 seconds
        if (now - player.lastChatTime < 5000) {
            this.io.to(socketId).emit('chat_error', { message: 'Wait 5 seconds before sending another message.' });
            return;
        }

        player.lastChatTime = now;
        this.lastGlobalChatTime = now;

        this.io.to(this.id).emit('chat_message', {
            senderId: socketId,
            senderName: player.name,
            message
        });
    }

    endGame() {
        this.status = 'finished';
        this.players.sort((a, b) => b.points - a.points);
        this.io.to(this.id).emit('game_finished', {
            players: this.players
        });
    }

    emitState() {
        let currentWarmup: number | null = null;
        let currentTimeLeft: number = 0;

        if (this.status === 'playing') {
            const now = Date.now();
            if (now < this.roundStartTime) {
                currentWarmup = Math.ceil((this.roundStartTime - now) / 1000);
                currentTimeLeft = this.roundTimeLimit;
            } else {
                const elapsed = Math.floor((now - this.roundStartTime) / 1000);
                currentTimeLeft = Math.max(0, this.roundTimeLimit - elapsed);
            }
        }

        this.io.to(this.id).emit('state_update', {
            id: this.id,
            host: this.host,
            maxPlayers: this.maxPlayers,
            status: this.status,
            players: this.players,
            currentCards: this.currentCards,
            cardsLeft: this.deck.length,
            currentRound: this.currentRound,
            maxRounds: this.maxRounds,
            roundStartTime: this.roundStartTime,
            roundTimeLimit: this.roundTimeLimit,
            votesToShuffle: this.votesToShuffle.size,
            voters: Array.from(this.votesToShuffle).map(vid => this.players.find(p => p.socketId === vid)?.name).filter(Boolean),
            currentWarmup,
            currentTimeLeft
        });
    }
}
