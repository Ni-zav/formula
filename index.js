const BACKGROUND = "#101010";
const FOREGROUND = "#50FF50";

console.log(game);
game.width = 800;
game.height = 800;
const ctx = game.getContext("2d");
console.log(ctx);

// ============================================
// Pre-compute optimized data structures
// ============================================

// Convert vertex objects to flat Float32Arrays for cache-friendly access
const vertexCount = vs.length;
const vsFlat = new Float32Array(vertexCount * 3);
for (let i = 0; i < vertexCount; i++) {
    vsFlat[i * 3] = vs[i].x;
    vsFlat[i * 3 + 1] = vs[i].y;
    vsFlat[i * 3 + 2] = vs[i].z;
}

// Build unique edge list to avoid duplicate line draws
// Each face draws its edges, but shared edges get drawn multiple times
const edgeSet = new Set();
const edges = [];

for (const f of fs) {
    for (let i = 0; i < f.length; ++i) {
        const a = f[i];
        const b = f[(i + 1) % f.length];
        // Create canonical edge key (smaller index first)
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        if (!edgeSet.has(key)) {
            edgeSet.add(key);
            edges.push([a, b]);
        }
    }
}

console.log(`Optimized: ${vertexCount} vertices, ${edges.length} unique edges (from ${fs.length} faces)`);

// Pre-allocated transformation buffers
const transformedX = new Float32Array(vertexCount);
const transformedY = new Float32Array(vertexCount);

// Pre-calculated screen center and scale
const halfWidth = game.width / 2;
const halfHeight = game.height / 2;

// ============================================
// Optimized render functions
// ============================================

function clear() {
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, game.width, game.height);
}

// Transform all vertices once per frame (batched)
function transformAllVertices(angle, dz) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    
    for (let i = 0; i < vertexCount; i++) {
        const idx = i * 3;
        const x = vsFlat[idx];
        const y = vsFlat[idx + 1];
        const z = vsFlat[idx + 2];
        
        // Rotate XZ
        const rx = x * cos - z * sin;
        const rz = x * sin + z * cos;
        
        // Translate Z and Project in one step
        const tz = rz + dz;
        const invZ = 1 / tz; // Cache division result
        
        // Project and convert to screen coordinates
        const px = rx * invZ;
        const py = y * invZ;
        
        // Screen transform: -1..1 => 0..width/height
        transformedX[i] = (px + 1) * halfWidth;
        transformedY[i] = (1 - py - 1) * halfHeight + halfHeight; // Simplified: (1 - (py + 1)/2) * height
    }
}

let dz = 1;
let angle = 0;
let lastTime = performance.now();
let frameCount = 0;
let fps = 0;

// Optional: Level of Detail - skip edges for distant/small details
// Set to 1 for full detail, higher = fewer edges drawn
const LOD_SKIP = 1; 

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
    
    // Transform all vertices once
    transformAllVertices(angle, dz);
    
    // Batch all lines into a single path
    ctx.strokeStyle = FOREGROUND;
    ctx.lineWidth = 1;
    ctx.beginPath();
    
    // Draw unique edges only
    const edgeCount = edges.length;
    for (let i = 0; i < edgeCount; i += LOD_SKIP) {
        const edge = edges[i];
        const a = edge[0];
        const b = edge[1];
        
        ctx.moveTo(transformedX[a], transformedY[a]);
        ctx.lineTo(transformedX[b], transformedY[b]);
    }
    
    ctx.stroke(); // Single stroke call for all lines!
    
    // Draw FPS counter
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "16px monospace";
    ctx.fillText(`FPS: ${fps} | Vertices: ${vertexCount} | Edges: ${edges.length}`, 10, 20);
    
    requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
