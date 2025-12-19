const COLS = 10;
const ROWS = 20;

const PIECES = {
    'I': [[1, 1, 1, 1]],
    'J': [[1, 0, 0], [1, 1, 1]],
    'L': [[0, 0, 1], [1, 1, 1]],
    'O': [[1, 1], [1, 1]],
    'S': [[0, 1, 1], [1, 1, 0]],
    'T': [[0, 1, 0], [1, 1, 1]],
    'Z': [[1, 1, 0], [0, 1, 1]]
};

const COLORS = {
    'I': '#00f0f0',
    'J': '#0000f0',
    'L': '#f0a000',
    'O': '#f0f000',
    'S': '#00f000',
    'T': '#a000f0',
    'Z': '#f00000'
};

class Game {
    constructor(canvas, nextCanvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.nextCanvas = nextCanvas;
        this.nextCtx = nextCanvas.getContext('2d');

        this.grid = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
        this.score = 0;
        this.gameOver = false;

        this.piece = null;
        this.nextPiece = this.generatePiece();

        // Polish
        this.particles = [];
        this.level = 1;
        this.linesClearedTotal = 0;

        this.blockSize = 0;
        this.resize();

        this.onScoreChange = null;
        this.onGameOver = null;
        this.onLock = null;
        this.onStateChange = null; // For multiplayer sync
        this.onPieceSpawn = null;
        this.pieceCount = 0;
    }

    resize() {
        const parent = this.canvas.parentElement;
        if (!parent) return;

        // Calculate block size to fit perfectly in both dimensions
        this.blockSize = Math.min(
            parent.clientWidth / COLS,
            parent.clientHeight / ROWS
        );

        this.canvas.width = this.blockSize * COLS;
        this.canvas.height = this.blockSize * ROWS;

        // Sync next canvas size
        const nextParent = this.nextCanvas.parentElement;
        if (nextParent) {
            this.nextCanvas.width = nextParent.clientWidth * window.devicePixelRatio;
            this.nextCanvas.height = nextParent.clientHeight * window.devicePixelRatio;
            this.nextCanvas.style.width = `${nextParent.clientWidth}px`;
            this.nextCanvas.style.height = `${nextParent.clientHeight}px`;
        }

        this.draw();
        this.drawNext();
    }

    generatePiece() {
        const types = Object.keys(PIECES);
        const type = types[Math.floor(Math.random() * types.length)];
        return {
            type,
            shape: PIECES[type],
            color: COLORS[type],
            x: Math.floor(COLS / 2) - Math.floor(PIECES[type][0].length / 2),
            y: 0
        };
    }

    spawnPiece() {
        this.piece = this.nextPiece;
        this.nextPiece = this.generatePiece();

        if (this.checkCollision(this.piece.x, this.piece.y, this.piece.shape)) {
            this.gameOver = true;
            if (this.onGameOver) this.onGameOver(this.score);
        }

        this.drawNext();
        this.pieceCount++;
        if (this.onPieceSpawn) this.onPieceSpawn(this.pieceCount);
        if (this.onStateChange) this.onStateChange();
    }

    checkCollision(x, y, shape) {
        for (let row = 0; row < shape.length; row++) {
            for (let col = 0; col < shape[row].length; col++) {
                if (shape[row][col]) {
                    const newX = x + col;
                    const newY = y + row;
                    if (newX < 0 || newX >= COLS || newY >= ROWS || (newY >= 0 && this.grid[newY][newX])) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    move(dx, dy) {
        if (this.gameOver) return false;
        if (!this.checkCollision(this.piece.x + dx, this.piece.y + dy, this.piece.shape)) {
            this.piece.x += dx;
            this.piece.y += dy;
            this.draw();
            if (this.onStateChange) this.onStateChange();
            return true;
        }
        if (dy > 0) {
            this.lockPiece();
        }
        return false;
    }

    rotate() {
        if (this.gameOver) return;
        const rotated = this.piece.shape[0].map((_, i) =>
            this.piece.shape.map(row => row[i]).reverse()
        );

        // Wall kick simple implementation
        let offset = 0;
        if (this.checkCollision(this.piece.x, this.piece.y, rotated)) {
            offset = this.piece.x > COLS / 2 ? -1 : 1;
            if (this.checkCollision(this.piece.x + offset, this.piece.y, rotated)) {
                return;
            }
        }

        this.piece.x += offset;
        this.piece.shape = rotated;
        this.draw();
        if (this.onStateChange) this.onStateChange();
    }

    lockPiece() {
        this.piece.shape.forEach((row, r) => {
            row.forEach((value, c) => {
                if (value) {
                    const y = this.piece.y + r;
                    if (y >= 0) this.grid[y][this.piece.x + c] = this.piece.color;
                }
            });
        });
        this.clearLines();
        if (this.onLock) this.onLock();
        this.spawnPiece();
    }

    clearLines() {
        let linesCleared = 0;
        let rowsToClear = [];
        for (let r = ROWS - 1; r >= 0; r--) {
            if (this.grid[r].every(cell => cell !== 0)) {
                rowsToClear.push(r);
                this.grid.splice(r, 1);
                this.grid.unshift(Array(COLS).fill(0));
                linesCleared++;
                r++;
            }
        }
        if (linesCleared > 0) {
            this.score += [0, 100, 300, 500, 800][linesCleared];
            this.linesClearedTotal += linesCleared;
            this.level = Math.floor(this.linesClearedTotal / 10) + 1;

            // Trigger effects
            rowsToClear.forEach(y => this.spawnParticles(y));
            this.triggerScreenShake();

            if (this.onScoreChange) this.onScoreChange(this.score);
        }
    }

    draw() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        this.drawGrid();

        // Draw grid
        this.grid.forEach((row, r) => {
            row.forEach((color, c) => {
                if (color) {
                    this.drawBlock(this.ctx, c, r, color);
                }
            });
        });

        // Draw ghost piece
        if (this.piece) {
            this.drawGhost();
        }

        // Draw active piece
        if (this.piece) {
            this.piece.shape.forEach((row, r) => {
                row.forEach((value, c) => {
                    if (value) {
                        this.drawBlock(this.ctx, this.piece.x + c, this.piece.y + r, this.piece.color);
                    }
                });
            });
        }

        // Draw particles
        this.drawParticles(this.ctx);
    }

    drawGhost() {
        let ghostY = this.piece.y;
        while (!this.checkCollision(this.piece.x, ghostY + 1, this.piece.shape)) {
            ghostY++;
        }

        this.ctx.save();
        this.ctx.globalAlpha = 0.2; // Faint ghost
        this.piece.shape.forEach((row, r) => {
            row.forEach((value, c) => {
                if (value) {
                    const x = this.piece.x + c;
                    const y = ghostY + r;
                    const padding = 1;
                    const size = this.blockSize - padding * 2;
                    const rx = x * this.blockSize + padding;
                    const ry = y * this.blockSize + padding;

                    this.ctx.strokeStyle = this.piece.color;
                    this.ctx.lineWidth = 1;
                    this.ctx.strokeRect(rx, ry, size, size);
                    this.ctx.fillStyle = this.piece.color;
                    this.ctx.fillRect(rx, ry, size, size);
                }
            });
        });
        this.ctx.restore();
    }

    drawGrid() {
        const ctx = this.ctx;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)'; // Extremely faint
        ctx.lineWidth = 1;
        ctx.beginPath();

        // Vertical lines
        for (let x = 0; x <= COLS; x++) {
            const px = x * this.blockSize;
            ctx.moveTo(px, 0);
            ctx.lineTo(px, this.canvas.height);
        }

        // Horizontal lines
        for (let y = 0; y <= ROWS; y++) {
            const py = y * this.blockSize;
            ctx.moveTo(0, py);
            ctx.lineTo(this.canvas.width, py);
        }

        ctx.stroke();
    }

    drawNext() {
        if (!this.nextPiece) return;
        const ctx = this.nextCtx;
        ctx.clearRect(0, 0, this.nextCanvas.width, this.nextCanvas.height);

        const shape = this.nextPiece.shape;
        const rows = shape.length;
        const cols = shape[0].length;

        // Maximize size within the canvas
        const padding = 2; // Minimal padding
        const availableHeight = this.nextCanvas.height - padding * 2;
        const availableWidth = this.nextCanvas.width - padding * 2;
        const size = Math.min(availableWidth / cols, availableHeight / rows);

        const offsetX = (this.nextCanvas.width - cols * size) / 2;
        const offsetY = (this.nextCanvas.height - rows * size) / 2;

        const color = this.nextPiece.color;

        shape.forEach((row, r) => {
            row.forEach((value, c) => {
                if (value) {
                    const rx = offsetX + c * size;
                    const ry = offsetY + r * size;
                    const innerSize = size - 1; // 1px gap for geometric look

                    ctx.fillStyle = color;
                    ctx.fillRect(rx, ry, innerSize, innerSize);

                    // Geometric border
                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
                    ctx.lineWidth = 1;
                    ctx.strokeRect(rx, ry, innerSize, innerSize);
                }
            });
        });
    }

    drawBlock(ctx, x, y, color) {
        const padding = 1; // Distinct separation
        const size = this.blockSize - padding * 2;
        const rx = x * this.blockSize + padding;
        const ry = y * this.blockSize + padding;

        // Flat fill with slight lightness boost for "matte plastic" look
        ctx.fillStyle = color;
        ctx.fillRect(rx, ry, size, size);

        // Crisp border for geometric clearer definition
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 1;
        ctx.strokeRect(rx, ry, size, size);

        // Optional: Very subtle inner highlight for shape definition without 3Dness
        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.fillRect(rx, ry, size, size);
    }

    shadeColor(color, percent) {
        let f = parseInt(color.slice(1), 16),
            t = percent < 0 ? 0 : 255,
            p = percent < 0 ? percent * -1 / 100 : percent / 100,
            R = f >> 16,
            G = f >> 8 & 0x00FF,
            B = f & 0x0000FF;
        return "#" + (0x1000000 + (Math.round((t - R) * p) + R) * 0x10000 + (Math.round((t - G) * p) + G) * 0x100 + (Math.round((t - B) * p) + B)).toString(16).slice(1);
    }

    reset() {
        this.grid = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
        this.score = 0;
        this.linesClearedTotal = 0;
        this.level = 1;
        this.gameOver = false;
        this.particles = [];
        this.spawnPiece();
        this.draw();
    }

    // Polish Methods
    spawnParticles(rowY) {
        // Spawn confetti across the cleared row
        for (let c = 0; c < COLS; c++) {
            // Spawn 5-8 particles per block
            const count = 5 + Math.floor(Math.random() * 4);
            const color = this.grid[rowY] && this.grid[rowY][c] ? this.grid[rowY][c] : COLORS[Object.keys(COLORS)[Math.floor(Math.random() * 7)]];

            for (let i = 0; i < count; i++) {
                this.particles.push({
                    x: c * this.blockSize + this.blockSize / 2,
                    y: rowY * this.blockSize + this.blockSize / 2,
                    vx: (Math.random() - 0.5) * 10,
                    vy: (Math.random() - 0.5) * 10,
                    life: 1.0,
                    color: color,
                    size: Math.random() * 4 + 2
                });
            }
        }
    }

    updateParticles(dt) {
        // dt is in ms, we want fractions of seconds roughly, or just tune values
        // Assuming dt is around 16ms
        const timeScale = dt / 16.0;

        for (let i = this.particles.length - 1; i >= 0; i--) {
            let p = this.particles[i];
            p.x += p.vx * timeScale;
            p.y += p.vy * timeScale;
            p.life -= 0.02 * timeScale;
            p.vy += 0.5 * timeScale; // Gravity

            if (p.life <= 0) {
                this.particles.splice(i, 1);
            }
        }
    }

    drawParticles(ctx) {
        ctx.save();
        this.particles.forEach(p => {
            ctx.globalAlpha = p.life;
            ctx.fillStyle = p.color;
            ctx.fillRect(p.x, p.y, p.size, p.size);
        });
        ctx.restore();
    }

    triggerScreenShake() {
        const wrapper = document.getElementById('game-wrapper');
        if (wrapper) {
            wrapper.classList.remove('shake');
            void wrapper.offsetWidth; // Trigger reflow
            wrapper.classList.add('shake');
        }

        // Haptic feedback
        if (navigator.vibrate) {
            navigator.vibrate(100);
        }
    }

    getLevel() {
        return this.level;
    }
}
