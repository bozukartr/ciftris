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

        this.blockSize = 0;
        this.resize();

        this.onScoreChange = null;
        this.onGameOver = null;
        this.onStateChange = null; // For multiplayer sync
    }

    resize() {
        const parent = this.canvas.parentElement;
        this.blockSize = parent.clientWidth / COLS;
        this.canvas.width = parent.clientWidth;
        this.canvas.height = parent.clientHeight;
        this.draw();
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
        this.spawnPiece();
    }

    clearLines() {
        let linesCleared = 0;
        for (let r = ROWS - 1; r >= 0; r--) {
            if (this.grid[r].every(cell => cell !== 0)) {
                this.grid.splice(r, 1);
                this.grid.unshift(Array(COLS).fill(0));
                linesCleared++;
                r++;
            }
        }
        if (linesCleared > 0) {
            this.score += [0, 100, 300, 500, 800][linesCleared];
            if (this.onScoreChange) this.onScoreChange(this.score);
        }
    }

    draw() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw grid
        this.grid.forEach((row, r) => {
            row.forEach((color, c) => {
                if (color) {
                    this.drawBlock(this.ctx, c, r, color);
                }
            });
        });

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
    }

    drawNext() {
        if (!this.nextPiece) return;
        this.nextCtx.clearRect(0, 0, this.nextCanvas.width, this.nextCanvas.height);

        const shape = this.nextPiece.shape;
        const rows = shape.length;
        const cols = shape[0].length;

        // Calculate block size to fit in nextCanvas
        const padding = 10;
        const availableHeight = this.nextCanvas.height - padding * 2;
        const availableWidth = this.nextCanvas.width - padding * 2;
        const size = Math.min(availableWidth / cols, availableHeight / rows, this.blockSize * 0.8);

        const offsetX = (this.nextCanvas.width - cols * size) / 2;
        const offsetY = (this.nextCanvas.height - rows * size) / 2;

        shape.forEach((row, r) => {
            row.forEach((value, c) => {
                if (value) {
                    const rx = offsetX + c * size;
                    const ry = offsetY + r * size;
                    const radius = size * 0.2;
                    const innerSize = size - 2;

                    this.nextCtx.save();
                    this.nextCtx.beginPath();
                    this.nextCtx.roundRect(rx + 1, ry + 1, innerSize, innerSize, radius);
                    this.nextCtx.fillStyle = this.nextPiece.color;
                    this.nextCtx.fill();

                    const gradient = this.nextCtx.createLinearGradient(rx, ry, rx + size, ry + size);
                    gradient.addColorStop(0, 'rgba(255, 255, 255, 0.2)');
                    gradient.addColorStop(1, 'rgba(0, 0, 0, 0.1)');
                    this.nextCtx.fillStyle = gradient;
                    this.nextCtx.fill();

                    this.nextCtx.restore();
                }
            });
        });
    }

    drawBlock(ctx, x, y, color) {
        const padding = 2;
        const size = this.blockSize - padding * 2;
        const rx = x * this.blockSize + padding;
        const ry = y * this.blockSize + padding;
        const radius = 6;

        ctx.save();

        // Rounded rectangle path
        ctx.beginPath();
        ctx.moveTo(rx + radius, ry);
        ctx.lineTo(rx + size - radius, ry);
        ctx.quadraticCurveTo(rx + size, ry, rx + size, ry + radius);
        ctx.lineTo(rx + size, ry + size - radius);
        ctx.quadraticCurveTo(rx + size, ry + size, rx + size - radius, ry + size);
        ctx.lineTo(rx + radius, ry + size);
        ctx.quadraticCurveTo(rx, ry + size, rx, ry + size - radius);
        ctx.lineTo(rx, ry + radius);
        ctx.quadraticCurveTo(rx, ry, rx + radius, ry);
        ctx.closePath();

        // Gradient
        const gradient = ctx.createLinearGradient(rx, ry, rx + size, ry + size);
        gradient.addColorStop(0, color);
        gradient.addColorStop(1, this.shadeColor(color, -20));

        ctx.fillStyle = gradient;
        ctx.fill();

        // Inner highlight
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.restore();
    }

    shadeColor(color, percent) {
        let R = parseInt(color.substring(1, 3), 16);
        let G = parseInt(color.substring(3, 5), 16);
        let B = parseInt(color.substring(5, 7), 16);

        R = parseInt(R * (100 + percent) / 100);
        G = parseInt(G * (100 + percent) / 100);
        B = parseInt(B * (100 + percent) / 100);

        R = (R < 255) ? R : 255;
        G = (G < 255) ? G : 255;
        B = (B < 255) ? B : 255;

        const RR = ((R.toString(16).length === 1) ? "0" + R.toString(16) : R.toString(16));
        const GG = ((G.toString(16).length === 1) ? "0" + G.toString(16) : G.toString(16));
        const BB = ((B.toString(16).length === 1) ? "0" + B.toString(16) : B.toString(16));

        return "#" + RR + GG + BB;
    }

    reset() {
        this.grid = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
        this.score = 0;
        this.gameOver = false;
        this.spawnPiece();
        this.draw();
    }
}
