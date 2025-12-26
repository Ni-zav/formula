const BACKGROUND = "#101010";
const FOREGROUND = "#50FF50";

// ============================================
// CAMERA SETTINGS (can be modified via UI)
// ============================================
const CAMERA = {
    // Camera type: "perspective" or "orthographic"
    type: "perspective",
    
    // Focal length in mm (only affects perspective mode)
    // Common values: 24mm (wide), 35mm (standard), 50mm (normal), 85mm (portrait), 200mm (telephoto)
    focalLength: 35,
    
    // Sensor width in mm (35mm full-frame standard)
    sensorWidth: 36,
    
    // Zoom/scale (stored independently for each mode)
    perspectiveZoom: 1.0,
    orthoZoom: 1.0,
    
    // Camera pitch/elevation in degrees (-90 to 90)
    // 0 = looking straight at horizon
    // positive = looking down from above
    // negative = looking up from below
    pitch: 20,
    
    // Rotation speed multiplier (0 = stopped)
    rotationSpeed: 0.5,
    
    // Camera distance from origin
    distance: 1.0,
};

// ============================================
// UI Controls
// ============================================
const btnPerspective = document.getElementById('btn-perspective');
const btnOrtho = document.getElementById('btn-ortho');
const focalSlider = document.getElementById('focal-slider');
const focalValue = document.getElementById('focal-value');
const focalBox = document.getElementById('focal-box');
const zoomSlider = document.getElementById('zoom-slider');
const zoomValue = document.getElementById('zoom-value');
const pitchSlider = document.getElementById('pitch-slider');
const pitchValue = document.getElementById('pitch-value');
const speedSlider = document.getElementById('speed-slider');
const speedValue = document.getElementById('speed-value');
const fileInput = document.getElementById('file-input');
const loadBtn = document.getElementById('load-btn');
const modelNameEl = document.getElementById('model-name');

// Control containers for scroll support
const zoomBox = document.getElementById('zoom-box');
const pitchControl = document.getElementById('pitch-control');
const speedControl = document.getElementById('speed-control');

// ============================================
// Scroll wheel support for control containers
// ============================================
function addScrollSupport(container, slider, valueEl, formatFn, updateFn) {
    container.addEventListener('wheel', (e) => {
        e.preventDefault();
        e.stopPropagation(); // Prevent bubbling to other controls
        
        const step = parseFloat(slider.step) || 1;
        const min = parseFloat(slider.min);
        const max = parseFloat(slider.max);
        let val = parseFloat(slider.value);
        
        // Scroll up = increase, scroll down = decrease
        val += e.deltaY < 0 ? step : -step;
        val = Math.max(min, Math.min(max, val));
        
        slider.value = val;
        valueEl.textContent = formatFn(val);
        if (updateFn) updateFn(val);
    }, { passive: false });
}

// Apply scroll support to control containers (hover anywhere in the box)
addScrollSupport(focalBox, focalSlider, focalValue, v => `${Math.round(v)}mm`, v => CAMERA.focalLength = Math.round(v));
addScrollSupport(zoomBox, zoomSlider, zoomValue, v => `${v.toFixed(1)}x`, v => {
    if (CAMERA.type === 'perspective') CAMERA.perspectiveZoom = v;
    else CAMERA.orthoZoom = v;
});
addScrollSupport(pitchControl, pitchSlider, pitchValue, v => `${Math.round(v)}°`, v => CAMERA.pitch = Math.round(v));
addScrollSupport(speedControl, speedSlider, speedValue, v => `${v.toFixed(1)}x`, v => CAMERA.rotationSpeed = v);

let savedSpeed = 0.5;

document.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
        e.preventDefault();
        if (CAMERA.rotationSpeed > 0) {
            savedSpeed = CAMERA.rotationSpeed;
            CAMERA.rotationSpeed = 0;
        } else {
            CAMERA.rotationSpeed = savedSpeed;
        }
        speedSlider.value = CAMERA.rotationSpeed;
        speedValue.textContent = `${CAMERA.rotationSpeed.toFixed(1)}x`;
    }
});

btnPerspective.addEventListener('click', () => {
    CAMERA.type = 'perspective';
    btnPerspective.classList.add('active');
    btnOrtho.classList.remove('active');
    focalBox.style.display = 'flex';
    // Restore perspective zoom
    zoomSlider.value = CAMERA.perspectiveZoom;
    zoomValue.textContent = `${CAMERA.perspectiveZoom.toFixed(1)}x`;
});

btnOrtho.addEventListener('click', () => {
    CAMERA.type = 'orthographic';
    btnOrtho.classList.add('active');
    btnPerspective.classList.remove('active');
    focalBox.style.display = 'none';
    // Restore ortho zoom
    zoomSlider.value = CAMERA.orthoZoom;
    zoomValue.textContent = `${CAMERA.orthoZoom.toFixed(1)}x`;
});

// Focal length slider
focalSlider.addEventListener('input', (e) => {
    CAMERA.focalLength = parseInt(e.target.value);
    focalValue.textContent = `${CAMERA.focalLength}mm`;
});

// Zoom slider (stores value for current mode)
zoomSlider.addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    if (CAMERA.type === 'perspective') {
        CAMERA.perspectiveZoom = value;
    } else {
        CAMERA.orthoZoom = value;
    }
    zoomValue.textContent = `${value.toFixed(1)}x`;
});

// Pitch slider
pitchSlider.addEventListener('input', (e) => {
    CAMERA.pitch = parseInt(e.target.value);
    pitchValue.textContent = `${CAMERA.pitch}°`;
});

// Speed slider
speedSlider.addEventListener('input', (e) => {
    CAMERA.rotationSpeed = parseFloat(e.target.value);
    speedValue.textContent = `${CAMERA.rotationSpeed.toFixed(1)}x`;
});

// ============================================
// Initialize sliders to match CAMERA defaults
// ============================================
function initSliders() {
    // Focal slider
    focalSlider.value = CAMERA.focalLength;
    focalValue.textContent = `${CAMERA.focalLength}mm`;
    
    // Zoom slider (use perspective zoom by default)
    zoomSlider.value = CAMERA.perspectiveZoom;
    zoomValue.textContent = `${CAMERA.perspectiveZoom.toFixed(1)}x`;
    
    // Pitch slider
    pitchSlider.value = CAMERA.pitch;
    pitchValue.textContent = `${CAMERA.pitch}°`;
    
    // Speed slider
    speedSlider.value = CAMERA.rotationSpeed;
    speedValue.textContent = `${CAMERA.rotationSpeed.toFixed(1)}x`;
}

// Initialize sliders on load
initSliders();

// ============================================
// Derived camera values
// ============================================
function getFocalScale() {
    return CAMERA.focalLength / (CAMERA.sensorWidth / 2);
}

// ============================================
// Canvas Setup
// ============================================
game.width = 800;
game.height = 800;
const ctx = game.getContext("2d");

// ============================================
// Model data structures (will be initialized)
// ============================================
let vertexCount = 0;
let vsFlat = null;
let edges = [];
let transformedX = null;
let transformedY = null;
let modelLoaded = false;

// Global model data (will be populated when a model is loaded)
let vs = null;
let fs = null;

// ============================================
// Initialize model from global vs/fs
// ============================================
function initModel() {
    if (!vs || !fs) {
        console.warn('Model data not available');
        return;
    }
    
    vertexCount = vs.length;
    vsFlat = new Float32Array(vertexCount * 3);
    
    for (let i = 0; i < vertexCount; i++) {
        vsFlat[i * 3] = vs[i].x;
        vsFlat[i * 3 + 1] = vs[i].y;
        vsFlat[i * 3 + 2] = vs[i].z;
    }
    
    // Build unique edge list
    const edgeSet = new Set();
    edges = [];
    
    for (const f of fs) {
        for (let i = 0; i < f.length; ++i) {
            const a = f[i];
            const b = f[(i + 1) % f.length];
            const key = a < b ? `${a}-${b}` : `${b}-${a}`;
            if (!edgeSet.has(key)) {
                edgeSet.add(key);
                edges.push([a, b]);
            }
        }
    }
    
    // Pre-allocated transformation buffers
    transformedX = new Float32Array(vertexCount);
    transformedY = new Float32Array(vertexCount);
    
    modelLoaded = true;
    console.log(`Loaded: ${vertexCount} vertices, ${edges.length} unique edges`);
}

// ============================================
// File browser model loading
// ============================================
loadBtn.addEventListener('click', () => {
    fileInput.click();
});

fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    if (!file.name.endsWith('.js')) {
        console.error('Please select a .js file');
        return;
    }
    
    const reader = new FileReader();
    reader.onload = (event) => {
        const code = event.target.result;
        
        // Clear previous model data
        window.vs = undefined;
        window.fs = undefined;
        modelLoaded = false;
        
        try {
            // Modify the code to use window assignments instead of const
            // This allows reloading models without const redeclaration errors
            const modifiedCode = code
                .replace(/const\s+vs\s*=/g, 'window.vs =')
                .replace(/const\s+fs\s*=/g, 'window.fs =')
                .replace(/let\s+vs\s*=/g, 'window.vs =')
                .replace(/let\s+fs\s*=/g, 'window.fs =')
                .replace(/var\s+vs\s*=/g, 'window.vs =')
                .replace(/var\s+fs\s*=/g, 'window.fs =');
            
            // Execute the modified code
            eval(modifiedCode);
            
            // Map window.vs/fs to global vs/fs for compatibility
            vs = window.vs;
            fs = window.fs;
            
            // Validate that vs and fs exist and are arrays
            if (!vs || !fs || !Array.isArray(vs) || !Array.isArray(fs)) {
                throw new Error('Invalid model format');
            }
            
            // Initialize the model
            initModel();
            
            // Update UI with model name (success)
            const displayName = file.name.replace('.js', '');
            modelNameEl.textContent = displayName;
            modelNameEl.classList.remove('empty');
            modelNameEl.style.color = '#50FF50';
            
        } catch (error) {
            console.error('Failed to load model:', error);
            
            // Show warning in UI
            modelNameEl.textContent = 'Invalid model (missing vs/fs)';
            modelNameEl.classList.add('empty');
            modelNameEl.style.color = '#FF5050';
            modelLoaded = false;
        }
    };
    
    reader.onerror = () => {
        console.error('Failed to read file');
        modelNameEl.textContent = 'Failed to read file';
        modelNameEl.classList.add('empty');
        modelNameEl.style.color = '#FF5050';
    };
    
    reader.readAsText(file);
    
    // Clear the input so the same file can be selected again
    fileInput.value = '';
});

const halfWidth = game.width / 2;
const halfHeight = game.height / 2;

// ============================================
// Render functions
// ============================================

function clear() {
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, game.width, game.height);
}

function transformAllVertices(angle, dz) {
    const cosY = Math.cos(angle);
    const sinY = Math.sin(angle);
    
    // Pitch rotation (around X axis) - negate so positive = looking from above
    const pitchRad = -CAMERA.pitch * Math.PI / 180;
    const cosX = Math.cos(pitchRad);
    const sinX = Math.sin(pitchRad);
    
    const focalScale = getFocalScale();
    const isPerspective = CAMERA.type === "perspective";
    const zoom = isPerspective ? CAMERA.perspectiveZoom : CAMERA.orthoZoom;
    
    for (let i = 0; i < vertexCount; i++) {
        const idx = i * 3;
        const x = vsFlat[idx];
        const y = vsFlat[idx + 1];
        const z = vsFlat[idx + 2];
        
        // Rotate around Y axis (horizontal spin)
        const rx = x * cosY - z * sinY;
        const rz = x * sinY + z * cosY;
        
        // Rotate around X axis (pitch/elevation)
        const ry = y * cosX - rz * sinX;
        const rz2 = y * sinX + rz * cosX;
        
        // Translate Z
        const tz = rz2 + dz;
        
        let px, py;
        
        if (isPerspective) {
            // Perspective: divide by Z with focal scale + zoom
            const invZ = (focalScale * zoom) / tz;
            px = rx * invZ;
            py = ry * invZ;
        } else {
            // Orthographic: no depth effect
            px = rx * zoom;
            py = ry * zoom;
        }
        
        transformedX[i] = px * halfWidth + halfWidth;
        transformedY[i] = -py * halfHeight + halfHeight;
    }
}

let angle = 0;
let lastTime = performance.now();
let frameCount = 0;
let fps = 0;

function frame() {
    frameCount++;
    const now = performance.now();
    if (now - lastTime >= 1000) {
        fps = frameCount;
        frameCount = 0;
        lastTime = now;
    }
    
    angle += (Math.PI / 60) * CAMERA.rotationSpeed;
    clear();
    
    // Only render if model is loaded
    if (modelLoaded && vertexCount > 0) {
        transformAllVertices(angle, CAMERA.distance);
        
        ctx.strokeStyle = FOREGROUND;
        ctx.lineWidth = 1;
        ctx.beginPath();
        
        const edgeCount = edges.length;
        for (let i = 0; i < edgeCount; i++) {
            const edge = edges[i];
            ctx.moveTo(transformedX[edge[0]], transformedY[edge[0]]);
            ctx.lineTo(transformedX[edge[1]], transformedY[edge[1]]);
        }
        
        ctx.stroke();
    } else {
        // Show placeholder text when no model is loaded
        ctx.fillStyle = "#333";
        ctx.font = "14px monospace";
        ctx.textAlign = "center";
        ctx.fillText("No model loaded", halfWidth, halfHeight - 10);
        ctx.fillStyle = "#555";
        ctx.font = "12px monospace";
        ctx.fillText("Click 'Load .js' to select a model file", halfWidth, halfHeight + 15);
        ctx.textAlign = "left";
    }
    
    // Info overlay
    ctx.fillStyle = "#666";
    ctx.font = "12px monospace";
    ctx.fillText(`${fps} FPS`, 10, 20);
    
    requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
