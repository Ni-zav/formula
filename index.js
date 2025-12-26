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
const convertBtn = document.getElementById('convert-btn');
const convertFileInput = document.getElementById('convert-file-input');

// Control containers for scroll support
const zoomBox = document.getElementById('zoom-box');
const pitchControl = document.getElementById('pitch-control');
const speedControl = document.getElementById('speed-control');

// ============================================
// 3D Model Converter (Browser-based)
// Supports: OBJ, GLB, glTF, DAE, ASCII FBX
// ============================================
const ModelConverter = {
    // OBJ Parser
    parseOBJ(content) {
        const lines = content.split('\n');
        const vertices = [];
        const faces = [];

        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('v ')) {
                const parts = trimmed.split(/\s+/);
                vertices.push({
                    x: parseFloat(parts[1]),
                    y: parseFloat(parts[2]),
                    z: parseFloat(parts[3])
                });
            } else if (trimmed.startsWith('f ')) {
                const parts = trimmed.split(/\s+/);
                const face = [];
                for (let i = 1; i < parts.length; i++) {
                    const vIndex = parseInt(parts[i].split('/')[0]) - 1;
                    face.push(vIndex);
                }
                faces.push(face);
            }
        }

        return { vs: vertices, fs: faces };
    },

    // GLB/glTF Parser
    async parseGLB(buffer, filename) {
        const view = new DataView(buffer);
        const magic = view.getUint32(0, true);

        if (magic === 0x46546C67) { // 'glTF' binary
            return this.parseGLBBinary(buffer);
        } else {
            // Text glTF
            const decoder = new TextDecoder();
            const content = decoder.decode(buffer);
            return this.parseGLTFJson(JSON.parse(content));
        }
    },

    parseGLBBinary(buffer) {
        const view = new DataView(buffer);
        const totalLength = view.getUint32(8, true);

        let offset = 12;
        let jsonChunk = null;
        let binChunk = null;

        while (offset < totalLength) {
            const chunkLength = view.getUint32(offset, true);
            const chunkType = view.getUint32(offset + 4, true);
            offset += 8;

            if (chunkType === 0x4E4F534A) { // 'JSON'
                const decoder = new TextDecoder();
                jsonChunk = decoder.decode(new Uint8Array(buffer, offset, chunkLength));
            } else if (chunkType === 0x004E4942) { // 'BIN\0'
                binChunk = buffer.slice(offset, offset + chunkLength);
            }

            offset += chunkLength;
        }

        if (!jsonChunk) {
            throw new Error("No JSON chunk found in GLB file");
        }

        return this.parseGLTFJson(JSON.parse(jsonChunk), binChunk);
    },

    parseGLTFJson(gltf, embeddedBin = null) {
        const vertices = [];
        const faces = [];

        // Load buffers (only embedded for browser)
        const buffers = [];
        for (let i = 0; i < (gltf.buffers || []).length; i++) {
            const bufferDef = gltf.buffers[i];
            if (embeddedBin && i === 0 && !bufferDef.uri) {
                buffers.push(embeddedBin);
            } else if (bufferDef.uri && bufferDef.uri.startsWith('data:')) {
                const base64 = bufferDef.uri.split(',')[1];
                const binary = atob(base64);
                const bytes = new Uint8Array(binary.length);
                for (let j = 0; j < binary.length; j++) {
                    bytes[j] = binary.charCodeAt(j);
                }
                buffers.push(bytes.buffer);
            }
        }

        function getAccessorData(accessorIndex) {
            const accessor = gltf.accessors[accessorIndex];
            const bufferView = gltf.bufferViews[accessor.bufferView];
            const buffer = buffers[bufferView.buffer];
            const view = new DataView(buffer);

            const byteOffset = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);

            const componentSizes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
            const typeCounts = { 'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4 };

            const componentSize = componentSizes[accessor.componentType];
            const elementCount = typeCounts[accessor.type];
            const stride = bufferView.byteStride || (componentSize * elementCount);

            const result = [];

            for (let i = 0; i < accessor.count; i++) {
                const elementOffset = byteOffset + i * stride;

                for (let j = 0; j < elementCount; j++) {
                    const off = elementOffset + j * componentSize;

                    switch (accessor.componentType) {
                        case 5121: result.push(view.getUint8(off)); break;
                        case 5123: result.push(view.getUint16(off, true)); break;
                        case 5125: result.push(view.getUint32(off, true)); break;
                        case 5126: result.push(view.getFloat32(off, true)); break;
                    }
                }
            }

            return result;
        }

        let vertexOffset = 0;

        for (const mesh of (gltf.meshes || [])) {
            for (const primitive of (mesh.primitives || [])) {
                if (primitive.attributes && primitive.attributes.POSITION !== undefined) {
                    const positions = getAccessorData(primitive.attributes.POSITION);

                    for (let i = 0; i < positions.length; i += 3) {
                        vertices.push({
                            x: positions[i],
                            y: positions[i + 1],
                            z: positions[i + 2]
                        });
                    }

                    if (primitive.indices !== undefined) {
                        const indices = getAccessorData(primitive.indices);
                        for (let i = 0; i < indices.length; i += 3) {
                            faces.push([
                                indices[i] + vertexOffset,
                                indices[i + 1] + vertexOffset,
                                indices[i + 2] + vertexOffset
                            ]);
                        }
                    }

                    vertexOffset += positions.length / 3;
                }
            }
        }

        return { vs: vertices, fs: faces };
    },

    // DAE (Collada) Parser
    parseDAE(content) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(content, 'text/xml');
        const vertices = [];
        const faces = [];

        const geometries = doc.querySelectorAll('geometry');

        for (const geometry of geometries) {
            const mesh = geometry.querySelector('mesh');
            if (!mesh) continue;

            // Build source map
            const sources = {};
            for (const source of mesh.querySelectorAll('source')) {
                const id = source.getAttribute('id');
                const floatArray = source.querySelector('float_array');
                if (floatArray) {
                    sources[id] = floatArray.textContent.trim().split(/\s+/).map(parseFloat);
                }
            }

            // Find position source
            const verticesEl = mesh.querySelector('vertices');
            let positionSourceId = null;

            if (verticesEl) {
                const inputs = verticesEl.querySelectorAll('input');
                for (const input of inputs) {
                    if (input.getAttribute('semantic') === 'POSITION') {
                        positionSourceId = input.getAttribute('source').replace('#', '');
                        break;
                    }
                }
            }

            const positionData = sources[positionSourceId] || [];
            if (positionData.length === 0) continue;

            const vertexOffset = vertices.length;
            for (let i = 0; i < positionData.length; i += 3) {
                vertices.push({
                    x: positionData[i],
                    y: positionData[i + 1],
                    z: positionData[i + 2]
                });
            }

            // Parse triangles or polylist
            const triangles = mesh.querySelector('triangles') || mesh.querySelector('polylist');
            if (triangles) {
                const pElement = triangles.querySelector('p');
                if (pElement) {
                    const indices = pElement.textContent.trim().split(/\s+/).map(Number);
                    const inputs = triangles.querySelectorAll('input');
                    let stride = 1;
                    let vertexInputOffset = 0;

                    for (const input of inputs) {
                        const offset = parseInt(input.getAttribute('offset')) || 0;
                        stride = Math.max(stride, offset + 1);
                        if (input.getAttribute('semantic') === 'VERTEX') {
                            vertexInputOffset = offset;
                        }
                    }

                    const vcountEl = triangles.querySelector('vcount');
                    if (vcountEl) {
                        const vcounts = vcountEl.textContent.trim().split(/\s+/).map(Number);
                        let idx = 0;
                        for (const vcount of vcounts) {
                            const face = [];
                            for (let v = 0; v < vcount; v++) {
                                face.push(indices[idx + vertexInputOffset] + vertexOffset);
                                idx += stride;
                            }
                            if (face.length === 3) {
                                faces.push(face);
                            } else if (face.length > 3) {
                                for (let i = 1; i < face.length - 1; i++) {
                                    faces.push([face[0], face[i], face[i + 1]]);
                                }
                            }
                        }
                    } else {
                        for (let i = 0; i < indices.length; i += stride * 3) {
                            faces.push([
                                indices[i + vertexInputOffset] + vertexOffset,
                                indices[i + stride + vertexInputOffset] + vertexOffset,
                                indices[i + stride * 2 + vertexInputOffset] + vertexOffset
                            ]);
                        }
                    }
                }
            }
        }

        return { vs: vertices, fs: faces };
    },

    // ASCII FBX Parser (simplified)
    parseFBXAscii(content) {
        const vertices = [];
        const faces = [];

        const verticesMatch = content.match(/Vertices:\s*\*\d+\s*{\s*a:\s*([\d\s.,eE+-]+)/);
        const indicesMatch = content.match(/PolygonVertexIndex:\s*\*\d+\s*{\s*a:\s*([\d\s.,-]+)/);

        if (verticesMatch) {
            const vertexData = verticesMatch[1].split(',').map(v => parseFloat(v.trim()));
            for (let i = 0; i < vertexData.length; i += 3) {
                vertices.push({
                    x: vertexData[i],
                    y: vertexData[i + 1],
                    z: vertexData[i + 2]
                });
            }
        }

        if (indicesMatch) {
            const indexData = indicesMatch[1].split(',').map(v => parseInt(v.trim()));
            let face = [];
            for (const idx of indexData) {
                if (idx < 0) {
                    face.push(~idx);
                    if (face.length === 3) {
                        faces.push([...face]);
                    } else if (face.length > 3) {
                        for (let i = 1; i < face.length - 1; i++) {
                            faces.push([face[0], face[i], face[i + 1]]);
                        }
                    }
                    face = [];
                } else {
                    face.push(idx);
                }
            }
        }

        return { vs: vertices, fs: faces };
    },

    // Center and normalize model
    centerAndNormalize(vertices, targetSize = 1.5) {
        if (vertices.length === 0) return;

        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;

        for (const v of vertices) {
            minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
            minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
            minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z);
        }

        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const cz = (minZ + maxZ) / 2;

        const maxDimension = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
        const scale = maxDimension > 0 ? targetSize / maxDimension : 1;

        for (const v of vertices) {
            v.x = (v.x - cx) * scale;
            v.y = (v.y - cy) * scale;
            v.z = (v.z - cz) * scale;
        }
    },

    // Generate JS output
    generateOutput(data) {
        return `const vs = ${JSON.stringify(data.vs, null, 4)}

const fs = ${JSON.stringify(data.fs, null, 4)}
`;
    },

    // Main conversion function
    async convert(file) {
        const ext = file.name.split('.').pop().toLowerCase();
        const modelName = file.name.replace(/\.[^.]+$/, '');

        let data;

        if (ext === 'obj') {
            const content = await file.text();
            data = this.parseOBJ(content);
        } else if (ext === 'glb' || ext === 'gltf') {
            const buffer = await file.arrayBuffer();
            data = await this.parseGLB(buffer, file.name);
        } else if (ext === 'dae') {
            const content = await file.text();
            data = this.parseDAE(content);
        } else if (ext === 'fbx') {
            const content = await file.text();
            // Check if binary (first 21 chars should be "Kaydara FBX Binary")
            if (content.startsWith('Kaydara FBX Binary')) {
                throw new Error('Binary FBX files are not supported in browser. Please use ASCII FBX or convert to OBJ/GLB.');
            }
            data = this.parseFBXAscii(content);
        } else {
            throw new Error(`Unsupported format: ${ext}`);
        }

        if (!data.vs.length) {
            throw new Error('No vertices found in the model');
        }

        this.centerAndNormalize(data.vs);

        return {
            modelName,
            content: this.generateOutput(data),
            stats: { vertices: data.vs.length, faces: data.fs.length },
            data
        };
    }
};

// ============================================
// Convert Button Handler
// ============================================
convertBtn.addEventListener('click', () => {
    convertFileInput.click();
});

convertFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Show processing state
    convertBtn.disabled = true;
    convertBtn.classList.add('processing');
    modelNameEl.textContent = 'Converting...';
    modelNameEl.classList.add('empty');
    modelNameEl.style.color = '#888';

    try {
        const result = await ModelConverter.convert(file);

        // Create blob and trigger save dialog
        const blob = new Blob([result.content], { type: 'application/javascript' });
        const suggestedName = result.modelName + '.js';

        // Try using File System Access API for save dialog
        if ('showSaveFilePicker' in window) {
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: suggestedName,
                    types: [{
                        description: 'JavaScript Model File',
                        accept: { 'application/javascript': ['.js'] }
                    }]
                });

                const writable = await handle.createWritable();
                await writable.write(blob);
                await writable.close();

                // Auto-load the saved model
                loadConvertedModel(result);
                
                console.log(`✓ Saved and loaded: ${suggestedName}`);
            } catch (err) {
                if (err.name !== 'AbortError') {
                    throw err;
                }
                // User cancelled save dialog
                modelNameEl.textContent = 'Save cancelled';
                modelNameEl.style.color = '#888';
            }
        } else {
            // Fallback: auto-download and auto-load
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = suggestedName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            // Auto-load the converted model
            loadConvertedModel(result);
            
            console.log(`✓ Downloaded and loaded: ${suggestedName}`);
        }

    } catch (error) {
        console.error('Conversion failed:', error);
        modelNameEl.textContent = `Error: ${error.message}`;
        modelNameEl.classList.add('empty');
        modelNameEl.style.color = '#FF5050';
    } finally {
        convertBtn.disabled = false;
        convertBtn.classList.remove('processing');
        convertFileInput.value = '';
    }
});

// Load converted model directly from parsed data
function loadConvertedModel(result) {
    // Assign to global vs/fs used by initModel
    vs = result.data.vs;
    fs = result.data.fs;
    
    // Also map to window for compatibility with file loader
    window.vs = vs;
    window.fs = fs;
    
    initModel();
    
    modelNameEl.textContent = result.modelName;
    modelNameEl.classList.remove('empty');
    modelNameEl.style.color = '#50FF50';
    
    console.log(`Loaded: ${result.stats.vertices} vertices, ${result.stats.faces} faces`);
}

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
        ctx.lineWidth = 0.3;
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
