const BACKGROUND = "#101010"
const FOREGROUND = "#50FF50"

console.log(game)
game.width = 800
game.height = 800
const ctx = game.getContext("2d")
console.log(ctx)

function clear() {
    ctx.fillStyle = BACKGROUND
    ctx.fillRect(0, 0, game.width, game.height)
}

function point({x, y}) {
    const s = 20;
    ctx.fillStyle = FOREGROUND
    ctx.fillRect(x - s/2, y - s/2, s, s)
}

function screen(p) {
    // -1..1 => 0..2 => 0..1 => 0..w
    return {
        x: (p.x + 1)/2*game.width,
        y: (1 - (p.y + 1)/2)*game.height,
    }
}

function project({x, y, z}) {
    return {
        x: x/z,
        y: y/z,
    }
}

function translate_z({x, y, z}, dz) {
    return {x, y, z: z + dz};
}

function rotate_xz({x, y, z}, angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return {
        x: x*c-z*s,
        y,
        z: x*s+z*c,
    };
}

let dz = 1;
let angle = 0;
let lastTime = performance.now();
let frameCount = 0;
let fps = 0;

function frame() {
    // FPS calculation
    frameCount++;
    const now = performance.now();
    if (now - lastTime >= 1000) {
        fps = frameCount;
        frameCount = 0;
        lastTime = now;
    }
    
    angle += Math.PI / 60; // Fixed rotation speed
    clear();
    
    // Batch all lines into a single path for performance
    ctx.strokeStyle = FOREGROUND;
    ctx.lineWidth = 1; // Thinner lines for dense models
    ctx.beginPath();
    
    for (const f of fs) {
        for (let i = 0; i < f.length; ++i) {
            const a = vs[f[i]];
            const b = vs[f[(i+1)%f.length]];
            const p1 = screen(project(translate_z(rotate_xz(a, angle), dz)));
            const p2 = screen(project(translate_z(rotate_xz(b, angle), dz)));
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
        }
    }
    
    ctx.stroke(); // Single stroke call for all lines!
    
    // Draw FPS counter
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "16px monospace";
    ctx.fillText(`FPS: ${fps} | Vertices: ${vs.length} | Faces: ${fs.length}`, 10, 20);
    
    requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
