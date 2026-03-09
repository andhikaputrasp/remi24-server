"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateDeck = generateDeck;
exports.shuffleDeck = shuffleDeck;
// Keep a local helper to check if 4 numbers can make 24
function isSolvable(nums) {
    if (nums.length !== 4)
        return false;
    const ops = [(a, b) => a + b, (a, b) => a - b, (a, b) => a * b, (a, b) => b !== 0 ? a / b : NaN];
    let solvable = false;
    // Generate permutations
    const perms = [];
    const used = [false, false, false, false];
    const dfs = (path) => {
        if (path.length === 4) {
            perms.push([...path]);
            return;
        }
        for (let i = 0; i < 4; i++) {
            if (!used[i]) {
                used[i] = true;
                path.push(nums[i]);
                dfs(path);
                path.pop();
                used[i] = false;
            }
        }
    };
    dfs([]);
    for (const p of perms) {
        for (const op1 of ops) {
            for (const op2 of ops) {
                for (const op3 of ops) {
                    try {
                        // (a op b) op (c op d)
                        const r1 = op2(op1(p[0], p[1]), op3(p[2], p[3]));
                        // ((a op b) op c) op d
                        const r2 = op3(op2(op1(p[0], p[1]), p[2]), p[3]);
                        // a op ((b op c) op d)
                        const r3 = op1(p[0], op3(op2(p[1], p[2]), p[3]));
                        if (Math.abs(r1 - 24) < 0.0001 || Math.abs(r1 + 24) < 0.0001)
                            return true;
                        if (Math.abs(r2 - 24) < 0.0001 || Math.abs(r2 + 24) < 0.0001)
                            return true;
                        if (Math.abs(r3 - 24) < 0.0001 || Math.abs(r3 + 24) < 0.0001)
                            return true;
                    }
                    catch (e) {
                        // ignore divisions by zero NaN
                    }
                }
            }
        }
    }
    return false;
}
function generateDeck() {
    let pool = [];
    const suits = ['hearts', 'diamonds', 'clubs', 'spades'];
    for (const suit of suits) {
        for (let value = 1; value <= 10; value++) {
            pool.push({ value, suit });
        }
    }
    // We need 40 cards. Let's arrange them into 10 chunks of 4 cards.
    // We aim for 9 chunks to be solvable (90%), 1 to be random (which might or might not be solvable)
    let chunks = [];
    let attempts = 0;
    while (chunks.length < 10 && attempts < 1000) {
        attempts++;
        pool = shuffleDeck(pool);
        let validSet = true;
        let tempChunks = [];
        for (let i = 0; i < 10; i++) {
            const chunk = pool.slice(i * 4, i * 4 + 4);
            const nums = chunk.map(c => c.value);
            const solvable = isSolvable(nums);
            // First 9 chunks MUST be solvable. Last 1 chunk can be anything.
            if (i < 9 && !solvable) {
                validSet = false;
                break;
            }
            tempChunks.push(chunk);
        }
        if (validSet) {
            chunks = tempChunks;
            break;
        }
    }
    // Flatten chunks back to deck
    const finalDeck = [];
    for (const chunk of chunks) {
        finalDeck.push(...chunk);
    }
    return finalDeck;
}
function shuffleDeck(deck) {
    const shuffled = [...deck];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}
