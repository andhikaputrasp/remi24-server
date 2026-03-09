"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GameState = void 0;
const deck_1 = require("./deck");
const gameLogic_1 = require("./gameLogic");
class GameState {
    constructor(id, hostSocketId, maxPlayers, roundTimeLimit, io) {
        this.players = [];
        this.deck = [];
        this.currentCards = [];
        this.roundStartTime = 0;
        this.roundTimer = null;
        this.votesToShuffle = new Set();
        this.currentRound = 0;
        this.id = id;
        this.host = hostSocketId;
        this.maxPlayers = maxPlayers;
        this.roundTimeLimit = roundTimeLimit;
        this.status = 'waiting';
        this.io = io;
    }
    addPlayer(socketId, name) {
        const activePlayersCount = this.players.filter(p => !p.isSpectator).length;
        const isGameInProgress = this.status !== 'waiting' && this.status !== 'finished';
        const isFull = activePlayersCount >= this.maxPlayers;
        // If room is full or game started, they join as spectator
        const isSpectator = isGameInProgress || isFull;
        this.players.push({
            socketId,
            name,
            points: 0,
            isConnected: true,
            hasAnswered: false,
            answerTime: null,
            roundAnswer: null,
            attempts: 0,
            isSpectator
        });
        this.emitState();
    }
    removePlayer(socketId) {
        const player = this.players.find(p => p.socketId === socketId);
        if (player) {
            player.isConnected = false;
            this.emitState();
            // If we want to completely remove them in waiting state
            if (this.status === 'waiting') {
                this.players = this.players.filter(p => p.socketId !== socketId);
                this.emitState();
            }
        }
    }
    startGame(socketId) {
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
            this.deck = (0, deck_1.generateDeck)();
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
        this.players.forEach(p => {
            p.hasAnswered = false;
            p.answerTime = null;
            p.roundAnswer = null;
            p.attempts = 0;
        });
        this.roundStartTime = Date.now() + 3000;
        if (this.roundTimer)
            clearInterval(this.roundTimer);
        // Initial warmup emit
        this.io.to(this.id).emit('warmup_tick', 3);
        this.roundTimer = setInterval(() => {
            const now = Date.now();
            if (now < this.roundStartTime) {
                const warmupLeft = Math.ceil((this.roundStartTime - now) / 1000);
                if (warmupLeft > 0) {
                    this.io.to(this.id).emit('warmup_tick', warmupLeft);
                }
            }
            else {
                const elapsed = Math.floor((now - this.roundStartTime) / 1000);
                const left = this.roundTimeLimit - elapsed;
                if (left <= 0) {
                    if (this.roundTimer)
                        clearInterval(this.roundTimer);
                    this.roundTimer = null;
                    this.endRound();
                }
                else {
                    this.io.to(this.id).emit('time_tick', left);
                }
            }
        }, 1000);
        this.emitState();
    }
    submitAnswer(socketId, expression) {
        var _a;
        if (this.status !== 'playing')
            return;
        const player = this.players.find(p => p.socketId === socketId);
        if (!player || player.isSpectator || player.hasAnswered || player.attempts >= 3)
            return;
        // Automatically reject invalid inputs to prevent crash or logic exploit
        if (!/^[0-9+\-*/() ]+$/.test(expression)) {
            this.io.to(socketId).emit('answer_result', { success: false, message: 'Invalid format' });
            return;
        }
        player.attempts++;
        // Validate if expression uses exactly the 4 current cards
        const numbersUsed = ((_a = expression.match(/\d+/g)) === null || _a === void 0 ? void 0 : _a.map(Number)) || [];
        const _sortedCurrent = [...this.currentCards].map(c => c.value).sort();
        const _sortedUsed = [...numbersUsed].sort();
        // Check lengths and exact values
        if (_sortedCurrent.length !== _sortedUsed.length || !_sortedCurrent.every((val, index) => val === _sortedUsed[index])) {
            this.io.to(socketId).emit('answer_result', { success: false, message: 'Invalid cards used, must use exactly the 4 current cards' });
            return;
        }
        if ((0, gameLogic_1.evaluate24)(expression)) {
            player.hasAnswered = true;
            player.answerTime = Date.now() - this.roundStartTime;
            player.roundAnswer = expression;
            // Calculate points (faster answer = more points)
            // Max 100 points, min 10 points
            const fraction = player.answerTime / (this.roundTimeLimit * 1000);
            const earned = Math.max(10, Math.floor(100 * (1 - fraction)));
            player.points += earned;
            this.io.to(socketId).emit('answer_result', { success: true, message: 'Benar!' });
            // Ensure we broadcast the new state so clients update the 'Jawab' button and 'Answered' tags
            this.emitState();
            // Check if round should end (all or all but 1 answered, or all maxed out attempts)
            this.checkRoundEndCondition();
        }
        else {
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
        // If 1 or 0 people haven't finished (answered/maxed out), end the round IF there are > 1 players
        // If it's a 1-player game, end it immediately when they finish.
        if (activeCount === 1) {
            if (completedPlayers === 1)
                this.endRound();
        }
        else {
            if (unansweredCount <= 1 || completedPlayers === activeCount) {
                this.endRound();
            }
        }
    }
    voteShuffle(socketId) {
        if (this.status !== 'playing')
            return;
        const player = this.players.find(p => p.socketId === socketId);
        if (!player || player.isSpectator)
            return;
        // If anyone has already answered correctly, shuffle is disabled
        if (this.players.some(p => p.hasAnswered && !p.isSpectator))
            return;
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
                if (this.roundTimer)
                    clearInterval(this.roundTimer);
                this.io.to(this.id).emit('warmup_tick', 3);
                this.roundTimer = setInterval(() => {
                    const now = Date.now();
                    if (now < this.roundStartTime) {
                        const warmupLeft = Math.ceil((this.roundStartTime - now) / 1000);
                        if (warmupLeft > 0) {
                            this.io.to(this.id).emit('warmup_tick', warmupLeft);
                        }
                    }
                    else {
                        const elapsed = Math.floor((now - this.roundStartTime) / 1000);
                        const left = this.roundTimeLimit - elapsed;
                        if (left <= 0) {
                            if (this.roundTimer)
                                clearInterval(this.roundTimer);
                            this.roundTimer = null;
                            this.endRound();
                        }
                        else {
                            this.io.to(this.id).emit('time_tick', left);
                        }
                    }
                }, 1000);
                this.emitState();
            }
        }
    }
    endRound() {
        if (this.status !== 'playing')
            return;
        this.status = 'leaderboard';
        if (this.roundTimer) {
            clearInterval(this.roundTimer);
            this.roundTimer = null;
        }
        // Sort leaderboard by points
        this.players.sort((a, b) => b.points - a.points);
        this.emitState();
        this.io.to(this.id).emit('round_ended', {
            players: this.players,
            correctSequence: this.currentCards
        });
        // Loop up to 10 rounds
        if (this.currentRound >= 10 || this.deck.length < 4) {
            setTimeout(() => {
                this.endGame();
            }, 5000);
        }
        else {
            setTimeout(() => {
                this.startNextRound();
            }, 5000);
        }
    }
    endGame() {
        this.status = 'finished';
        this.players.sort((a, b) => b.points - a.points);
        this.io.to(this.id).emit('game_finished', {
            players: this.players
        });
    }
    emitState() {
        let currentWarmup = null;
        let currentTimeLeft = 0;
        if (this.status === 'playing') {
            const now = Date.now();
            if (now < this.roundStartTime) {
                currentWarmup = Math.ceil((this.roundStartTime - now) / 1000);
                currentTimeLeft = this.roundTimeLimit;
            }
            else {
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
            roundStartTime: this.roundStartTime,
            roundTimeLimit: this.roundTimeLimit,
            votesToShuffle: this.votesToShuffle.size,
            voters: Array.from(this.votesToShuffle).map(vid => { var _a; return (_a = this.players.find(p => p.socketId === vid)) === null || _a === void 0 ? void 0 : _a.name; }).filter(Boolean),
            currentWarmup,
            currentTimeLeft
        });
    }
}
exports.GameState = GameState;
