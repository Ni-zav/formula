const BACKGROUND = "#101010";
const FOREGROUND = "#50FF50";
const WIREFRAME_COLOR = "#2a7a2a";     // Darkened wireframe lines
const FACE_COLOR = "#0a2a0a"; // Solid face fill color (dark green for consistency)
const FACE_ALPHA = 0.3;       // Opacity for transparent solid mode (0-1)
const TRANSPARENT_FACE_COLOR = "#1a5a1a"; // Darker green for transparent faces
const TRANSPARENT_FACE_ALPHA = 0.25;   // Slightly darker transparent faces

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
    
    // Render mode settings
    render: {
        mode: 'wireframe',     // 'wireframe' or 'solid'
        solidType: 'opaque',   // 'transparent' (stacking) or 'opaque' (depth-sorted)
        showEdges: true,       // Show wireframe edges on solid mode
        showSilhouette: true   // Show silhouette/outline in all modes
    },
    
    // Backface Culling settings (hides faces facing away based on winding order)
    backfaceCull: {
        enabled: false
    },
    
    // Depth Culling settings (hides faces behind model center)
    depthCull: {
        enabled: false,
        threshold: 0  // -1 to 1, where 0 is model center
    }
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
const rotationSlider = document.getElementById('rotation-slider');
const rotationValue = document.getElementById('rotation-value');
const fileInput = document.getElementById('file-input');
const loadBtn = document.getElementById('load-btn');
const modelNameEl = document.getElementById('model-name');
const convertBtn = document.getElementById('convert-btn');
const convertFileInput = document.getElementById('convert-file-input');
const backfaceCullToggle = document.getElementById('backface-cull-toggle');
const depthCullToggle = document.getElementById('depth-cull-toggle');
const depthThresholdSlider = document.getElementById('depth-threshold-slider');
const depthThresholdValue = document.getElementById('depth-threshold-value');
const depthThresholdBox = document.getElementById('depth-threshold-box');
const renderModeToggle = document.getElementById('render-mode-toggle');
const showEdgesToggle = document.getElementById('show-edges-toggle');
const solidTypeToggle = document.getElementById('solid-type-toggle');
const showSilhouetteToggle = document.getElementById('show-silhouette-toggle');

// Control containers for scroll support
const zoomBox = document.getElementById('zoom-box');
const pitchControl = document.getElementById('pitch-control');
const speedControl = document.getElementById('speed-control');
const rotationControl = document.getElementById('rotation-control');

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
addScrollSupport(speedControl, speedSlider, speedValue, v => `${v.toFixed(1)}x`, v => CAMERA.rotationSpeed = v);

// Pitch scroll support with wrapping (0-360)
pitchControl.addEventListener('wheel', (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    const step = 5; // 5 degree steps
    let val = parseFloat(pitchSlider.value);
    
    val += e.deltaY < 0 ? step : -step;
    // Wrap around 0-360
    if (val >= 360) val -= 360;
    if (val < 0) val += 360;
    
    pitchSlider.value = val;
    pitchValue.textContent = `${Math.round(val)}°`;
    CAMERA.pitch = Math.round(val);
}, { passive: false });

// Rotation scroll support with wrapping
rotationControl.addEventListener('wheel', (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    const step = 5; // 5 degree steps
    let val = parseFloat(rotationSlider.value);
    
    val += e.deltaY < 0 ? step : -step;
    // Wrap around 0-360
    if (val >= 360) val -= 360;
    if (val < 0) val += 360;
    
    rotationSlider.value = val;
    rotationValue.textContent = `${Math.round(val)}°`;
    // Update the actual angle (convert degrees to radians)
    angle = val * Math.PI / 180;
}, { passive: false });
addScrollSupport(depthThresholdBox, depthThresholdSlider, depthThresholdValue, v => `${v.toFixed(1)}`, v => CAMERA.depthCull.threshold = v);

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

// Pitch slider with wrapping (0-360)
pitchSlider.addEventListener('input', (e) => {
    let val = parseFloat(e.target.value);
    // Wrap around 0-360
    if (val >= 360) val = 0;
    if (val < 0) val = 360 + val;
    pitchSlider.value = val;
    CAMERA.pitch = Math.round(val);
    pitchValue.textContent = `${CAMERA.pitch}°`;
});

// Speed slider
speedSlider.addEventListener('input', (e) => {
    CAMERA.rotationSpeed = parseFloat(e.target.value);
    speedValue.textContent = `${CAMERA.rotationSpeed.toFixed(1)}x`;
});

// Rotation slider
rotationSlider.addEventListener('input', (e) => {
    let val = parseFloat(e.target.value);
    // Wrap around 0-360
    if (val >= 360) val = 0;
    if (val < 0) val = 360 + val;
    rotationSlider.value = val;
    rotationValue.textContent = `${Math.round(val)}°`;
    // Update the actual angle (convert degrees to radians)
    angle = val * Math.PI / 180;
});

// ============================================
// Culling Controls
// ============================================
if (backfaceCullToggle) {
    backfaceCullToggle.addEventListener('click', () => {
        CAMERA.backfaceCull.enabled = !CAMERA.backfaceCull.enabled;
        backfaceCullToggle.classList.toggle('active', CAMERA.backfaceCull.enabled);
        backfaceCullToggle.textContent = CAMERA.backfaceCull.enabled ? 'On' : 'Off';
    });
}

if (depthCullToggle) {
    depthCullToggle.addEventListener('click', () => {
        CAMERA.depthCull.enabled = !CAMERA.depthCull.enabled;
        depthCullToggle.classList.toggle('active', CAMERA.depthCull.enabled);
        depthCullToggle.textContent = CAMERA.depthCull.enabled ? 'On' : 'Off';
        // Show/hide depth threshold slider
        if (depthThresholdBox) {
            depthThresholdBox.style.display = CAMERA.depthCull.enabled ? 'flex' : 'none';
        }
    });
}

// Depth threshold slider
if (depthThresholdSlider) {
    depthThresholdSlider.addEventListener('input', () => {
        CAMERA.depthCull.threshold = parseFloat(depthThresholdSlider.value);
        if (depthThresholdValue) {
            depthThresholdValue.textContent = CAMERA.depthCull.threshold.toFixed(1);
        }
    });
}

// ============================================
// Render Mode Controls (Wireframe / Solid)
// ============================================
function updateRenderModeUI() {
    const isSolid = CAMERA.render.mode === 'solid';
    
    if (renderModeToggle) {
        renderModeToggle.textContent = isSolid ? 'Solid' : 'Wire';
        renderModeToggle.classList.toggle('active', isSolid);
    }
    
    if (showEdgesToggle) {
        showEdgesToggle.style.display = isSolid ? 'inline-block' : 'none';
        showEdgesToggle.classList.toggle('active', CAMERA.render.showEdges);
        showEdgesToggle.textContent = CAMERA.render.showEdges ? 'Edges' : 'No Edge';
    }
    
    if (solidTypeToggle) {
        solidTypeToggle.style.display = isSolid ? 'inline-block' : 'none';
        const isOpaque = CAMERA.render.solidType === 'opaque';
        solidTypeToggle.classList.toggle('active', isOpaque);
        solidTypeToggle.textContent = isOpaque ? 'Opaque' : 'Trans';
    }
}

if (renderModeToggle) {
    renderModeToggle.addEventListener('click', () => {
        CAMERA.render.mode = CAMERA.render.mode === 'wireframe' ? 'solid' : 'wireframe';
        updateRenderModeUI();
    });
}

if (showEdgesToggle) {
    showEdgesToggle.addEventListener('click', () => {
        CAMERA.render.showEdges = !CAMERA.render.showEdges;
        showEdgesToggle.classList.toggle('active', CAMERA.render.showEdges);
        showEdgesToggle.textContent = CAMERA.render.showEdges ? 'Edges' : 'No Edge';
    });
}

if (solidTypeToggle) {
    solidTypeToggle.addEventListener('click', () => {
        CAMERA.render.solidType = CAMERA.render.solidType === 'opaque' ? 'transparent' : 'opaque';
        const isOpaque = CAMERA.render.solidType === 'opaque';
        solidTypeToggle.classList.toggle('active', isOpaque);
        solidTypeToggle.textContent = isOpaque ? 'Opaque' : 'Trans';
    });
}

if (showSilhouetteToggle) {
    showSilhouetteToggle.addEventListener('click', () => {
        CAMERA.render.showSilhouette = !CAMERA.render.showSilhouette;
        showSilhouetteToggle.classList.toggle('active', CAMERA.render.showSilhouette);
        showSilhouetteToggle.textContent = CAMERA.render.showSilhouette ? 'Silhouette' : 'No Sil';
    });
}

// Initialize render mode UI
updateRenderModeUI();

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
    
    // Rotation slider (starts at 0)
    rotationSlider.value = 0;
    rotationValue.textContent = `0°`;
}

// Initialize sliders on load
initSliders();

// ============================================
// Mouse drag rotation (like Blender orbit)
// ============================================
let isDragging = false;
let lastMouseX = 0;
let lastMouseY = 0;
let savedSpeedDuringDrag = 0;

game.addEventListener('mousedown', (e) => {
    isDragging = true;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    // Pause rotation while dragging
    savedSpeedDuringDrag = CAMERA.rotationSpeed;
    CAMERA.rotationSpeed = 0;
    speedSlider.value = 0;
    speedValue.textContent = '0.0x';
    game.style.cursor = 'grabbing';
});

document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    
    const deltaX = e.clientX - lastMouseX;
    const deltaY = e.clientY - lastMouseY;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    
    // Sensitivity factor (degrees per pixel)
    const sensitivity = 0.5;
    
    // Update rotation (horizontal drag = Y-axis rotation)
    let rotationDeg = (angle * 180 / Math.PI) + deltaX * sensitivity;
    // Wrap to 0-360
    while (rotationDeg >= 360) rotationDeg -= 360;
    while (rotationDeg < 0) rotationDeg += 360;
    angle = rotationDeg * Math.PI / 180;
    rotationSlider.value = Math.round(rotationDeg);
    rotationValue.textContent = `${Math.round(rotationDeg)}°`;
    
    // Update pitch (vertical drag = X-axis rotation)
    let pitchDeg = CAMERA.pitch + deltaY * sensitivity;
    // Wrap to 0-360
    while (pitchDeg >= 360) pitchDeg -= 360;
    while (pitchDeg < 0) pitchDeg += 360;
    CAMERA.pitch = Math.round(pitchDeg);
    pitchSlider.value = CAMERA.pitch;
    pitchValue.textContent = `${CAMERA.pitch}°`;
});

document.addEventListener('mouseup', () => {
    if (isDragging) {
        isDragging = false;
        game.style.cursor = 'grab';
    }
});

// Set initial cursor style
game.style.cursor = 'grab';

// ============================================
// Canvas scroll zoom
// ============================================
game.addEventListener('wheel', (e) => {
    e.preventDefault();
    
    const step = 0.1;
    const min = 0.2;
    const max = 3.0;
    
    // Get current zoom for active mode
    let currentZoom = CAMERA.type === 'perspective' ? CAMERA.perspectiveZoom : CAMERA.orthoZoom;
    
    // Scroll up = zoom in, scroll down = zoom out
    let newZoom = currentZoom + (e.deltaY < 0 ? step : -step);
    newZoom = Math.max(min, Math.min(max, newZoom));
    
    // Update camera and slider
    if (CAMERA.type === 'perspective') {
        CAMERA.perspectiveZoom = newZoom;
    } else {
        CAMERA.orthoZoom = newZoom;
    }
    
    zoomSlider.value = newZoom;
    zoomValue.textContent = `${newZoom.toFixed(1)}x`;
}, { passive: false });

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
let transformedZ = null; // Z-depth buffer for culling
let modelLoaded = false;

// Optimized z-culling data structures (pre-allocated)
let faceCount = 0;
let faceIndices = null;      // Flat array of face vertex indices
let faceOffsets = null;      // Start offset for each face in faceIndices
let faceLengths = null;      // Number of vertices per face
let faceNormalsFlat = null;  // Flat array: [nx, ny, nz, nx, ny, nz, ...]
let faceAvgZ = null;         // Average Z per face (Float32Array)
let faceVisible = null;      // Visibility flag per face (Uint8Array)
let faceIsFrontFacing = null; // Cache: is each face front-facing (Uint8Array)
let faceSortIndices = null;  // Pre-allocated sort indices
let edgeVisibility = null;   // Pre-allocated edge visibility (Uint8Array)
let edgeToFaces = null;      // Map edge index -> [faceIndex1, faceIndex2, ...]
let minVisibleFaceZ = Infinity; // Track minimum Z of rendered faces for silhouette culling

// Performance Optimization: Reusable global buffers to avoid per-frame allocation
let faceBBoxMinX = null;
let faceBBoxMaxX = null;
let faceBBoxMinY = null;
let faceBBoxMaxY = null;
const GRID_RES = 800; // Resolution for silhouette depth grid
let depthGrid = null; // Reusable depth grid buffer

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
    
    // Build unique edge list with integer keys for fast lookup
    const edgeMap = new Map(); // key -> edge index
    edges = [];
    
    function getEdgeKey(a, b) {
        // Create unique integer key for edge (works for up to ~65k vertices)
        return a < b ? (a * 65536 + b) : (b * 65536 + a);
    }
    
    for (const f of fs) {
        for (let i = 0; i < f.length; ++i) {
            const a = f[i];
            const b = f[(i + 1) % f.length];
            const key = getEdgeKey(a, b);
            if (!edgeMap.has(key)) {
                edgeMap.set(key, edges.length);
                edges.push([a, b]);
            }
        }
    }
    
    // Pre-allocated transformation buffers
    transformedX = new Float32Array(vertexCount);
    transformedY = new Float32Array(vertexCount);
    transformedZ = new Float32Array(vertexCount);
    
    // Count valid faces and total indices
    faceCount = 0;
    let totalFaceIndices = 0;
    for (let i = 0; i < fs.length; i++) {
        if (fs[i].length >= 3) {
            faceCount++;
            totalFaceIndices += fs[i].length;
        }
    }
    
    // Pre-allocate face data as flat typed arrays
    faceIndices = new Uint32Array(totalFaceIndices);
    faceOffsets = new Uint32Array(faceCount);
    faceLengths = new Uint8Array(faceCount);
    faceNormalsFlat = new Float32Array(faceCount * 3);
    faceAvgZ = new Float32Array(faceCount);
    faceVisible = new Uint8Array(faceCount);
    faceIsFrontFacing = new Uint8Array(faceCount);
    faceSortIndices = new Uint32Array(faceCount);
    edgeVisibility = new Uint8Array(edges.length);
    
    // Performance Optimization: Reusable face bounds arrays (limit GC)
    // Only re-allocate if the new model is larger than current capacity
    if (!faceBBoxMinX || faceBBoxMinX.length < faceCount) {
        faceBBoxMinX = new Float32Array(faceCount);
        faceBBoxMaxX = new Float32Array(faceCount);
        faceBBoxMinY = new Float32Array(faceCount);
        faceBBoxMaxY = new Float32Array(faceCount);
    }
    
    // Performance Optimization: Reusable depth grid for silhouettes
    if (!depthGrid) {
        depthGrid = new Float32Array(GRID_RES * GRID_RES);
    }
    
    // Build edge-to-faces mapping (which faces share each edge)
    edgeToFaces = new Array(edges.length);
    for (let i = 0; i < edges.length; i++) {
        edgeToFaces[i] = [];
    }
    
    let faceIdx = 0;
    let indexOffset = 0;
    
    for (let i = 0; i < fs.length; i++) {
        const f = fs[i];
        if (f.length < 3) continue;
        
        // Store face indices
        faceOffsets[faceIdx] = indexOffset;
        faceLengths[faceIdx] = f.length;
        for (let j = 0; j < f.length; j++) {
            faceIndices[indexOffset + j] = f[j];
        }
        
        // Map edges to this face
        for (let j = 0; j < f.length; j++) {
            const a = f[j];
            const b = f[(j + 1) % f.length];
            const key = getEdgeKey(a, b);
            const edgeIdx = edgeMap.get(key);
            if (edgeIdx !== undefined) {
                edgeToFaces[edgeIdx].push(faceIdx);
            }
        }
        
        // Compute face normal using first 3 vertices
        const v0 = vs[f[0]];
        const v1 = vs[f[1]];
        const v2 = vs[f[2]];
        
        // Edge vectors
        const ax = v1.x - v0.x, ay = v1.y - v0.y, az = v1.z - v0.z;
        const bx = v2.x - v0.x, by = v2.y - v0.y, bz = v2.z - v0.z;
        
        // Cross product for normal
        let nx = ay * bz - az * by;
        let ny = az * bx - ax * bz;
        let nz = ax * by - ay * bx;
        
        // Normalize
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (len > 0) {
            nx /= len;
            ny /= len;
            nz /= len;
        } else {
            nx = 0; ny = 0; nz = 1;
        }
        
        faceNormalsFlat[faceIdx * 3] = nx;
        faceNormalsFlat[faceIdx * 3 + 1] = ny;
        faceNormalsFlat[faceIdx * 3 + 2] = nz;
        
        // Initialize sort indices
        faceSortIndices[faceIdx] = faceIdx;
        
        indexOffset += f.length;
        faceIdx++;
    }
    
    modelLoaded = true;
    console.log(`Loaded: ${vertexCount} vertices, ${edges.length} edges, ${faceCount} faces`);
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
// Performance Optimizations
// ============================================

// Pre-computed constants
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const TWO_PI = Math.PI * 2;
const ANGLE_STEP = Math.PI / 60;

// Fast in-place quicksort for depth sorting (avoids callback overhead)
function quickSortDepth(indices, depths, left, right) {
    if (left >= right) return;
    
    const pivotIdx = indices[(left + right) >> 1];
    const pivot = depths[pivotIdx];
    let i = left, j = right;
    
    while (i <= j) {
        while (depths[indices[i]] > pivot) i++;
        while (depths[indices[j]] < pivot) j--;
        if (i <= j) {
            const tmp = indices[i];
            indices[i] = indices[j];
            indices[j] = tmp;
            i++;
            j--;
        }
    }
    
    if (left < j) quickSortDepth(indices, depths, left, j);
    if (i < right) quickSortDepth(indices, depths, i, right);
}

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
    const pitchRad = -CAMERA.pitch * DEG_TO_RAD;
    const cosX = Math.cos(pitchRad);
    const sinX = Math.sin(pitchRad);
    
    const focalScale = getFocalScale();
    const isPerspective = CAMERA.type === "perspective";
    const zoom = isPerspective ? CAMERA.perspectiveZoom : CAMERA.orthoZoom;
    
    // Cache typed array references and constants for hot loop
    const vsF = vsFlat;
    const txArr = transformedX;
    const tyArr = transformedY;
    const tzArr = transformedZ;
    const hw = halfWidth;
    const hh = halfHeight;
    const vCount = vertexCount;
    const focalZoom = focalScale * zoom;
    
    let sumZ = 0;
    
    if (isPerspective) {
        // Perspective projection loop
        for (let i = 0, idx = 0; i < vCount; i++, idx += 3) {
            const x = vsF[idx];
            const y = vsF[idx + 1];
            const z = vsF[idx + 2];
            
            // Rotate around Y axis (horizontal spin)
            const rx = x * cosY - z * sinY;
            const rz = x * sinY + z * cosY;
            
            // Rotate around X axis (pitch/elevation)
            const ry = y * cosX - rz * sinX;
            const tz = y * sinX + rz * cosX + dz;
            
            tzArr[i] = tz;
            sumZ += tz;
            
            // Perspective: divide by Z with focal scale + zoom
            const invZ = focalZoom / tz;
            txArr[i] = rx * invZ * hw + hw;
            tyArr[i] = -ry * invZ * hh + hh;
        }
    } else {
        // Orthographic projection loop
        const zoomHW = zoom * hw;
        const zoomHH = zoom * hh;
        
        for (let i = 0, idx = 0; i < vCount; i++, idx += 3) {
            const x = vsF[idx];
            const y = vsF[idx + 1];
            const z = vsF[idx + 2];
            
            // Rotate around Y axis (horizontal spin)
            const rx = x * cosY - z * sinY;
            const rz = x * sinY + z * cosY;
            
            // Rotate around X axis (pitch/elevation)
            const ry = y * cosX - rz * sinX;
            const tz = y * sinX + rz * cosX + dz;
            
            tzArr[i] = tz;
            sumZ += tz;
            
            // Orthographic: no depth effect
            txArr[i] = rx * zoomHW + hw;
            tyArr[i] = -ry * zoomHH + hh;
        }
    }
    
    // Update cached model center Z for backface culling
    modelCenterZ = sumZ / vCount;
}

let angle = 0;
let lastTime = performance.now();
let frameCount = 0;
let fps = 0;

// Cached model center Z - updated each frame during transformAllVertices
let modelCenterZ = 0;

// Helper: Check if a face should be visible using depth-based culling
// A face is visible if it's closer to the camera than the adjusted threshold
// threshold: -1 (show more back) to 1 (show more front), 0 = model center
function isFaceVisible(faceIdx) {
    const offset = faceOffsets[faceIdx];
    const len = faceLengths[faceIdx];
    if (len < 3) return true;
    
    // Calculate average Z depth of this face
    let faceAvgZ = 0;
    for (let j = 0; j < len; j++) {
        faceAvgZ += transformedZ[faceIndices[offset + j]];    }
    faceAvgZ /= len;
    
    // Apply threshold offset to model center
    // threshold ranges from -1 to 1, scale it to model size
    // Negative threshold = show more of the back, Positive = show less
    const thresholdZ = modelCenterZ + CAMERA.depthCull.threshold;
    
    // Face is visible if it's in front of (closer than) the threshold
    // In view space, smaller Z = closer to camera
    return faceAvgZ < thresholdZ;
}

// Helper: Check if a face is front-facing using screen-space signed area
// Uses the cross product of two edges for winding order check
function isFaceFrontFacing(faceIdx) {
    const offset = faceOffsets[faceIdx];
    const len = faceLengths[faceIdx];
    if (len < 3) return true;
    
    // Get first 3 vertices
    const v0 = faceIndices[offset];
    const v1 = faceIndices[offset + 1];
    const v2 = faceIndices[offset + 2];
    
    // Screen-space coordinates
    const x0 = transformedX[v0], y0 = transformedY[v0];
    const x1 = transformedX[v1], y1 = transformedY[v1];
    const x2 = transformedX[v2], y2 = transformedY[v2];
    
    // Signed area (2D cross product)
    // Positive signed area = front-facing (CW in screen space with Y-down)
    const signedArea = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    
    return signedArea > 0;
}

function frame() {
    frameCount++;
    const now = performance.now();
    if (now - lastTime >= 1000) {
        fps = frameCount;
        frameCount = 0;
        lastTime = now;
    }
    
    const rotSpeed = CAMERA.rotationSpeed;
    angle += ANGLE_STEP * rotSpeed;
    
    // Wrap angle to 0-2*PI range
    if (angle >= TWO_PI) angle -= TWO_PI;
    else if (angle < 0) angle += TWO_PI;
    
    // Update rotation slider to follow animation (when speed > 0)
    if (CAMERA.rotationSpeed !== 0) {
        const angleDeg = Math.round(angle * 180 / Math.PI);
        rotationSlider.value = angleDeg;
        rotationValue.textContent = `${angleDeg}°`;
    }
    
    clear();
    
    // Only render if model is loaded
    if (modelLoaded && vertexCount > 0) {
        transformAllVertices(angle, CAMERA.distance);
        
        if (CAMERA.render.mode === 'solid' && faceCount > 0) {
            // SOLID MODE: Draw filled faces
            const useBackfaceCull = CAMERA.backfaceCull.enabled;
            const useDepthCull = CAMERA.depthCull.enabled;
            const isTransparent = CAMERA.render.solidType === 'transparent';
            
            ctx.strokeStyle = FOREGROUND;
            ctx.lineWidth = 0.3;
            
            if (isTransparent) {
                // TRANSPARENT MODE: Semi-transparent faces that stack
                // MUST use per-face fill() for proper alpha blending of overlapping faces
                ctx.globalAlpha = TRANSPARENT_FACE_ALPHA;
                ctx.fillStyle = TRANSPARENT_FACE_COLOR;
                
                // Cache array references for hot loop
                const fOffsets = faceOffsets;
                const fLengths = faceLengths;
                const fIndices = faceIndices;
                const txArr = transformedX;
                const tyArr = transformedY;
                const tzArr = transformedZ;
                const fVisible = faceVisible;
                const fCount = faceCount;
                // Pre-calculate threshold Z
                const thresholdZ = modelCenterZ + CAMERA.depthCull.threshold;
                
                // Determine visibility and draw each face individually (for proper alpha stacking)
                const viewW = game.width;
                const viewH = game.height;

                for (let i = 0; i < fCount; i++) {
                    const offset = fOffsets[i];
                    const len = fLengths[i];
                    const v0 = fIndices[offset];
                    
                    // 1. INLINED Front Check (Signed Area)
                    const next1 = fIndices[offset + 1];
                    const next2 = fIndices[offset + 2];
                    const x0 = txArr[v0], y0 = tyArr[v0];
                    const x1 = txArr[next1], y1 = tyArr[next1];
                    const x2 = txArr[next2], y2 = tyArr[next2];
                    const signedArea = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
                    const isFront = signedArea > 0;
                    
                    if (useBackfaceCull && !isFront) {
                        fVisible[i] = 0;
                        continue;
                    }
                    
                    // 2. INLINED Depth & Tiny Face Check (Single Pass)
                    let sumZ = tzArr[v0];
                    let minX = x0, maxX = x0;
                    let minY = y0, maxY = y0;
                    
                    for (let j = 1; j < len; j++) {
                        const v = fIndices[offset + j];
                        const x = txArr[v], y = tyArr[v], z = tzArr[v];
                        sumZ += z;
                        if (x < minX) minX = x; else if (x > maxX) maxX = x;
                        if (y < minY) minY = y; else if (y > maxY) maxY = y;
                    }
                    
                    // Viewport Culling (Strict 2D Frustum Check)
                    if (maxX < 0 || minX > viewW || maxY < 0 || minY > viewH) {
                        fVisible[i] = 0;
                        continue;
                    }

                    // Check depth threshold
                    if (useDepthCull && (sumZ / len) >= thresholdZ) {
                        fVisible[i] = 0;
                        continue;
                    }
                    
                    // Skip tiny faces (< 2x2 pixels)
                    if ((maxX - minX) < 2 && (maxY - minY) < 2) {
                         fVisible[i] = 0;
                         continue;
                    }
                    
                    fVisible[i] = 1;
                    
                    // Draw each face individually so overlapping areas stack alpha
                    // OPTIMIZATION: Use integer coordinates for faster canvas rasterization
                    ctx.beginPath();
                    ctx.moveTo(x0 | 0, y0 | 0);
                    for (let j = 1; j < len; j++) {
                        const vert = fIndices[offset + j];
                        ctx.lineTo(txArr[vert] | 0, tyArr[vert] | 0);
                    }
                    ctx.closePath();
                    ctx.fill();
                }
                
                ctx.globalAlpha = 1.0;
            } else {
                // OPAQUE MODE: Draw solid faces with proper hidden-line removal
                // 
                // APPROACH: Per-edge occlusion testing
                // - For each silhouette edge, check if it's occluded by ANY front-facing face
                // - Use ALL front-facing faces for occlusion (not affected by depth culling)
                // - Only draw silhouettes that are NOT occluded
                //
                const showEdges = CAMERA.render.showEdges;
                const showSilhouette = CAMERA.render.showSilhouette;
                const viewW = game.width;
                const viewH = game.height;
                
                // Cache array references for hot loop
                const fOffsets = faceOffsets;
                const fLengths = faceLengths;
                const fIndices = faceIndices;
                const txArr = transformedX;
                const tyArr = transformedY;
                const tzArr = transformedZ;
                const fAvgZ = faceAvgZ;
                const fVisible = faceVisible;
                const fIsFront = faceIsFrontFacing;
                const fSortIdx = faceSortIndices;
                const fCount = faceCount;
                
                // Pre-compute face bounding boxes and Z for occlusion testing
                // These are used for ALL front-facing faces (not just visible ones)
                // NOTE: Globals faceBBoxMinX etc are used (reused) here
                
                // Calculate front-facing state and avgZ for ALL faces
                let visibleCount = 0;
                const thresholdZ = modelCenterZ + CAMERA.depthCull.threshold;
                
                for (let i = 0; i < fCount; i++) {
                    const offset = fOffsets[i];
                    const len = fLengths[i];
                    const v0 = fIndices[offset];
                    
                    // 1. INLINED Front Check
                    const v1 = fIndices[offset + 1], v2 = fIndices[offset + 2];
                    const x0 = txArr[v0], y0 = tyArr[v0];
                    const signedArea = (txArr[v1] - x0) * (tyArr[v2] - y0) - (txArr[v2] - x0) * (tyArr[v1] - y0);
                    const isFront = signedArea > 0;
                    fIsFront[i] = isFront ? 1 : 0;
                    
                    // 2. INLINED AvgZ + BBox (Single Pass)
                    let sumZ = tzArr[v0];
                    let minX = x0, maxX = x0;
                    let minY = y0, maxY = y0;
                    
                    for (let j = 1; j < len; j++) {
                        const v = fIndices[offset + j];
                        const x = txArr[v], y = tyArr[v], z = tzArr[v];
                        sumZ += z;
                        if (x < minX) minX = x; else if (x > maxX) maxX = x;
                        if (y < minY) minY = y; else if (y > maxY) maxY = y;
                    }
                    
                    fAvgZ[i] = sumZ / len;
                    faceBBoxMinX[i] = minX; faceBBoxMaxX[i] = maxX;
                    faceBBoxMinY[i] = minY; faceBBoxMaxY[i] = maxY;
                    
                    // Check visibility for rendering (respects culling toggles)
                    if (useBackfaceCull && !isFront) {
                        fVisible[i] = 0;
                        continue;
                    }

                    // Viewport Culling (Strict 2D Frustum Check) - BIG PERFORMANCE WIN
                    if (maxX < 0 || minX > viewW || maxY < 0 || minY > viewH) {
                        fVisible[i] = 0;
                        continue;
                    }

                    if (useDepthCull && fAvgZ[i] >= thresholdZ) {
                        fVisible[i] = 0;
                        continue;
                    }
                    
                    fVisible[i] = 1;
                    fSortIdx[visibleCount++] = i;
                }
                
                // Sort visible faces by depth (back-to-front)
                if (visibleCount > 1) {
                    quickSortDepth(fSortIdx, fAvgZ, 0, visibleCount - 1);
                }
                
                // Draw faces back-to-front
                ctx.fillStyle = FACE_COLOR;
                ctx.strokeStyle = FOREGROUND;
                ctx.lineWidth = 0.3;
                
                for (let s = 0; s < visibleCount; s++) {
                    const i = fSortIdx[s];
                    const offset = fOffsets[i];
                    const len = fLengths[i];
                    
                    ctx.beginPath();
                    const firstVert = fIndices[offset];
                    // OPTIMIZATION: Use integer coordinates
                    ctx.moveTo(txArr[firstVert] | 0, tyArr[firstVert] | 0);
                    for (let j = 1; j < len; j++) {
                        const vert = fIndices[offset + j];
                        ctx.lineTo(txArr[vert] | 0, tyArr[vert] | 0);
                    }
                    ctx.closePath();
                    ctx.fill();
                    if (showEdges) ctx.stroke();
                }
                
                // Draw silhouettes with depth-map based occlusion and edge splitting
                // Build a depth grid from ALL front-facing faces using SCANLINE RASTERIZATION
                // with proper per-pixel Z interpolation via barycentric coordinates
                if (showSilhouette) {
                    // Optimized: Reuse global depthGrid (allocated in initModel)
                    depthGrid.fill(Infinity);
                    
                    const canvasW = game.width;
                    const canvasH = game.height;
                    const scaleX = GRID_RES / canvasW;
                    const scaleY = GRID_RES / canvasH;
                    
                    // Track min/max Z for relative tolerance
                    let minFrontZ = Infinity, maxFrontZ = -Infinity;
                    
                    // Optimized scanline triangle rasterization with Z interpolation
                    // Uses horizontal scanlines and edge walking for efficiency
                    for (let f = 0; f < fCount; f++) {
                        // OPAQUE MODE: Only consider front-facing faces for occlusion
                        if (!fIsFront[f]) continue;
                        
                        const offset = fOffsets[f];
                        const len = fLengths[f];
                        if (len < 3) continue;
                        
                        // Track Z range
                        const faceZ = fAvgZ[f];
                        if (faceZ < minFrontZ) minFrontZ = faceZ;
                        if (faceZ > maxFrontZ) maxFrontZ = faceZ;
                        
                        // Fan triangulation for n-gons
                        for (let tri = 0; tri < len - 2; tri++) {
                            const vi0 = fIndices[offset];
                            const vi1 = fIndices[offset + tri + 1];
                            const vi2 = fIndices[offset + tri + 2];
                            
                            // Get coordinates in grid space and Z values
                            let gx0 = txArr[vi0] * scaleX, gy0 = tyArr[vi0] * scaleY, gz0 = tzArr[vi0];
                            let gx1 = txArr[vi1] * scaleX, gy1 = tyArr[vi1] * scaleY, gz1 = tzArr[vi1];
                            let gx2 = txArr[vi2] * scaleX, gy2 = tyArr[vi2] * scaleY, gz2 = tzArr[vi2];
                            
                            // Sort vertices by Y (gy0 <= gy1 <= gy2)
                            if (gy0 > gy1) { let t = gx0; gx0 = gx1; gx1 = t; t = gy0; gy0 = gy1; gy1 = t; t = gz0; gz0 = gz1; gz1 = t; }
                            if (gy1 > gy2) { let t = gx1; gx1 = gx2; gx2 = t; t = gy1; gy1 = gy2; gy2 = t; t = gz1; gz1 = gz2; gz2 = t; }
                            if (gy0 > gy1) { let t = gx0; gx0 = gx1; gx1 = t; t = gy0; gy0 = gy1; gy1 = t; t = gz0; gz0 = gz1; gz1 = t; }
                            
                            // Skip degenerate triangles
                            const totalHeight = gy2 - gy0;
                            if (totalHeight < 0.0001) continue;
                            
                            // Clamp to grid bounds
                            const minY = Math.max(0, Math.ceil(gy0));
                            const maxY = Math.min(GRID_RES - 1, Math.floor(gy2));
                            
                            // Pre-compute edge slopes
                            const invTotalHeight = 1.0 / totalHeight;
                            const topHeight = gy1 - gy0;
                            const bottomHeight = gy2 - gy1;
                            const hasTopHalf = topHeight > 0.0001;
                            const hasBottomHalf = bottomHeight > 0.0001;
                            
                            // Scanline rasterization
                            for (let y = minY; y <= maxY; y++) {
                                const yf = y + 0.5;
                                
                                // Compute X intercepts on the two edges
                                // Long edge: v0 -> v2 (always present)
                                const tLong = (yf - gy0) * invTotalHeight;
                                const xLong = gx0 + (gx2 - gx0) * tLong;
                                const zLong = gz0 + (gz2 - gz0) * tLong;
                                
                                // Short edge depends on which half we're in
                                let xShort, zShort;
                                if (yf < gy1 && hasTopHalf) {
                                    // Top half: v0 -> v1
                                    const tShort = (yf - gy0) / topHeight;
                                    xShort = gx0 + (gx1 - gx0) * tShort;
                                    zShort = gz0 + (gz1 - gz0) * tShort;
                                } else if (hasBottomHalf) {
                                    // Bottom half: v1 -> v2
                                    const tShort = (yf - gy1) / bottomHeight;
                                    xShort = gx1 + (gx2 - gx1) * tShort;
                                    zShort = gz1 + (gz2 - gz1) * tShort;
                                } else if (hasTopHalf) {
                                    const tShort = (yf - gy0) / topHeight;
                                    xShort = gx0 + (gx1 - gx0) * tShort;
                                    zShort = gz0 + (gz1 - gz0) * tShort;
                                } else {
                                    continue;
                                }
                                
                                // Ensure xLeft <= xRight
                                let xLeft, xRight, zLeft, zRight;
                                if (xLong < xShort) {
                                    xLeft = xLong; xRight = xShort;
                                    zLeft = zLong; zRight = zShort;
                                } else {
                                    xLeft = xShort; xRight = xLong;
                                    zLeft = zShort; zRight = zLong;
                                }
                                
                                // Clamp X to grid bounds
                                const startX = Math.max(0, Math.ceil(xLeft));
                                const endX = Math.min(GRID_RES - 1, Math.floor(xRight));
                                
                                if (startX > endX) continue;
                                
                                // Interpolate Z along the scanline
                                const spanWidth = xRight - xLeft;
                                const rowOffset = y * GRID_RES;
                                
                                if (spanWidth < 0.0001) {
                                    // Very thin span - use average Z
                                    const z = (zLeft + zRight) * 0.5;
                                    for (let x = startX; x <= endX; x++) {
                                        const idx = rowOffset + x;
                                        if (z < depthGrid[idx]) depthGrid[idx] = z;
                                    }
                                } else {
                                    const invSpanWidth = 1.0 / spanWidth;
                                    for (let x = startX; x <= endX; x++) {
                                        const t = (x + 0.5 - xLeft) * invSpanWidth;
                                        const z = zLeft + (zRight - zLeft) * t;
                                        const idx = rowOffset + x;
                                        if (z < depthGrid[idx]) depthGrid[idx] = z;
                                    }
                                }
                            }
                        }
                    }
                    // Relative tolerance for depth comparison
                    const depthRange = maxFrontZ - minFrontZ;
                    
                    // "Tight" Tolerance for avoiding background bleed-through (0.3%)
                    const TIGHT_TOLERANCE = Math.max(0.003, depthRange * 0.003);
                    
                    // "Background" Threshold for detecting significant depth gaps (5%)
                    // If a sample is this much deeper than the edge, it's definitely a background surface
                    const BACKGROUND_THRESHOLD = Math.max(0.05, depthRange * 0.05);
                    
                    // Helper: sample depth grid with bounds check
                    function sampleDepthGrid(x, y) {
                        const gx = Math.max(0, Math.min(GRID_RES - 1, Math.floor(x * scaleX)));
                        const gy = Math.max(0, Math.min(GRID_RES - 1, Math.floor(y * scaleY)));
                        return depthGrid[gy * GRID_RES + gx];
                    }
                    
                    // Multi-sample visibility check with perpendicular offset
                    // This helps avoid self-occlusion where silhouette edges meet their own front faces
                    function isEdgePointVisible(px, py, pz, nx, ny) {
                        // Sample at center and offset perpendicular to edge direction
                        // Restore reasonable offset to sample neighborhood (not single pixel)
                        const OFFSET = 1.0; 
                        
                        // Helper to classify sample visibility
                        function checkSample(d) {
                            if (d === Infinity) return 2; // Strong Pass (Open Space)
                            const diff = d - pz;
                            if (diff > BACKGROUND_THRESHOLD) return 2; // Strong Pass (Background Surface)
                            if (diff >= -TIGHT_TOLERANCE) return 1; // Weak Pass (Self/Surface)
                            return 0; // Fail (Occluded)
                        }

                        // Collect votes
                        const v0 = checkSample(sampleDepthGrid(px, py));
                        const v1 = checkSample(sampleDepthGrid(px + nx * OFFSET, py + ny * OFFSET));
                        const v2 = checkSample(sampleDepthGrid(px - nx * OFFSET, py - ny * OFFSET));
                        
                        // Logic:
                        // - If ANY sample is a "Strong Pass" (Background/Infinity), the edge is on a silhouette boundary -> SHOW IT.
                        // - Otherwise, require Majority (2+) "Weak Passes" to confirm it's a visible surface detail.
                        
                        if (v0 === 2 || v1 === 2 || v2 === 2) return true;
                        
                        // Count weak passes
                        const weakVotes = (v0 >= 1 ? 1 : 0) + (v1 >= 1 ? 1 : 0) + (v2 >= 1 ? 1 : 0);
                        return weakVotes >= 2;
                    }
                    
                    ctx.beginPath();
                    ctx.strokeStyle = FOREGROUND;
                    ctx.lineWidth = 0.6;
                    
                    const edgeLen = edges.length;
                    
                    for (let i = 0; i < edgeLen; i++) {
                        const adjacentFaces = edgeToFaces[i];
                        const edge = edges[i];
                        
                        // Determine if this is a silhouette edge
                        let isSilhouette = false;
                        if (adjacentFaces.length === 1) {
                            // Boundary edge: visible if face is front
                             isSilhouette = fIsFront[adjacentFaces[0]] === 1;
                        } else if (adjacentFaces.length === 2) {
                            isSilhouette = fIsFront[adjacentFaces[0]] !== fIsFront[adjacentFaces[1]];
                        }
                        
                        if (!isSilhouette) continue;
                        
                        const v0 = edge[0], v1 = edge[1];
                        const x0 = txArr[v0], y0 = tyArr[v0], z0 = tzArr[v0];
                        const x1 = txArr[v1], y1 = tyArr[v1], z1 = tzArr[v1];
                        
                        // Compute edge direction and perpendicular normal for offset sampling
                        const dx = x1 - x0, dy = y1 - y0;
                        const edgeLen2D = Math.sqrt(dx * dx + dy * dy);
                        if (edgeLen2D < 1) continue; // Skip tiny edges
                        
                        // Perpendicular normal (rotated 90 degrees)
                        const invLen = 1.0 / edgeLen2D;
                        const nx = -dy * invLen;
                        const ny = dx * invLen;
                        
                        // Adaptive sample count: ~4px spacing, min 4, max 20
                        const NUM_SAMPLES = Math.max(4, Math.min(20, Math.ceil(edgeLen2D / 4)));
                        const invSamples = 1.0 / NUM_SAMPLES;
                        
                        let segmentStart = -1;
                        
                        for (let s = 0; s <= NUM_SAMPLES; s++) {
                            const t = s * invSamples;
                            const px = x0 + dx * t;
                            const py = y0 + dy * t;
                            const pz = z0 + (z1 - z0) * t;
                            const visible = isEdgePointVisible(px, py, pz, nx, ny);
                            
                            if (visible) {
                                if (segmentStart === -1) segmentStart = s;
                            } else if (segmentStart !== -1) {
                                // Draw visible segment
                                const t0 = segmentStart * invSamples;
                                const t1 = (s - 1) * invSamples;
                                ctx.moveTo(x0 + dx * t0, y0 + dy * t0);
                                ctx.lineTo(x0 + dx * t1, y0 + dy * t1);
                                segmentStart = -1;
                            }
                        }
                        
                        // Handle segment extending to edge end
                        if (segmentStart !== -1) {
                            const t0 = segmentStart * invSamples;
                            ctx.moveTo(x0 + dx * t0, y0 + dy * t0);
                            ctx.lineTo(x1, y1);
                        }
                    }
                    
                    ctx.stroke();
                }
            }
            
            // Draw edges for TRANSPARENT mode only (opaque mode draws edges per-face above)
            if (isTransparent && CAMERA.render.showEdges) {
                ctx.beginPath();
                
                // Use cached faceVisible for edge visibility
                const edgeArr = edges;
                const edgeLen = edgeArr.length;
                const e2f = edgeToFaces;
                const fVisible = faceVisible;
                const txArr = transformedX;
                const tyArr = transformedY;
                
                for (let i = 0; i < edgeLen; i++) {
                    const adjacentFaces = e2f[i];
                    const adjLen = adjacentFaces.length;
                    let edgeVis = false;
                    
                    for (let j = 0; j < adjLen; j++) {
                        if (fVisible[adjacentFaces[j]]) {
                            edgeVis = true;
                            break;
                        }
                    }
                    
                    if (edgeVis) {
                        const edge = edgeArr[i];
                        ctx.moveTo(txArr[edge[0]], tyArr[edge[0]]);
                        ctx.lineTo(txArr[edge[1]], tyArr[edge[1]]);
                    }
                }
                
                ctx.stroke();
            }
        } else if ((CAMERA.backfaceCull.enabled || CAMERA.depthCull.enabled) && faceCount > 0) {
            // WIREFRAME MODE with Culling
            ctx.strokeStyle = WIREFRAME_COLOR;
            ctx.lineWidth = 0.3;
            
            const useBackfaceCull = CAMERA.backfaceCull.enabled;
            const useDepthCull = CAMERA.depthCull.enabled;
            const fVisible = faceVisible;
            const fIsFront = faceIsFrontFacing;
            const fCount = faceCount;
            const thresholdZ = modelCenterZ + CAMERA.depthCull.threshold;
            const tzArr = transformedZ;
            
            // Cache face visibility and front-facing state first
            for (let i = 0; i < fCount; i++) {
                // 1. INLINED Front Check
                const offset = faceOffsets[i];
                const v0 = faceIndices[offset];
                const v1 = faceIndices[offset + 1];
                const v2 = faceIndices[offset + 2];
                const x0 = transformedX[v0], y0 = transformedY[v0];
                const x1 = transformedX[v1], y1 = transformedY[v1];
                const x2 = transformedX[v2], y2 = transformedY[v2];
                const signedArea = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
                const isFront = signedArea > 0;
                
                fIsFront[i] = isFront ? 1 : 0;
                
                // Backface culling
                if (useBackfaceCull && !isFront) {
                    fVisible[i] = 0;
                    continue;
                }
                
                // Depth culling
                if (useDepthCull) {
                    // Calculate AvgZ inline
                    let sumZ = tzArr[v0];
                    const len = faceLengths[i];
                    for (let j = 1; j < len; j++) {
                        sumZ += tzArr[faceIndices[offset + j]];
                    }
                    if ((sumZ / len) >= thresholdZ) {
                         fVisible[i] = 0;
                         continue;
                    }
                }
                fVisible[i] = 1;
            }
            
            ctx.beginPath();
            
            const edgeArr = edges;
            const edgeLen = edgeArr.length;
            const e2f = edgeToFaces;
            const txArr = transformedX;
            const tyArr = transformedY;
            
            for (let i = 0; i < edgeLen; i++) {
                const adjacentFaces = e2f[i];
                const adjLen = adjacentFaces.length;
                let edgeVis = false;
                
                for (let j = 0; j < adjLen; j++) {
                    if (fVisible[adjacentFaces[j]]) {
                        edgeVis = true;
                        break;
                    }
                }
                
                if (edgeVis) {
                    const edge = edgeArr[i];
                    ctx.moveTo(txArr[edge[0]], tyArr[edge[0]]);
                    ctx.lineTo(txArr[edge[1]], tyArr[edge[1]]);
                }
            }
            
            ctx.stroke();
        } else {
            // WIREFRAME MODE without Z-Culling
            ctx.strokeStyle = WIREFRAME_COLOR;
            ctx.lineWidth = 0.3;
            ctx.beginPath();
            
            const edgeArr = edges;
            const edgeLen = edgeArr.length;
            const txArr = transformedX;
            const tyArr = transformedY;
            
            for (let i = 0; i < edgeLen; i++) {
                const edge = edgeArr[i];
                ctx.moveTo(txArr[edge[0]], tyArr[edge[0]]);
                ctx.lineTo(txArr[edge[1]], tyArr[edge[1]]);
            }
            
            ctx.stroke();
        }
        
        // Draw silhouettes for NON-OPAQUE modes
        // (Opaque mode silhouettes are handled above with proper painter's algorithm occlusion)
        // 
        // MODE-SPECIFIC BEHAVIOR:
        // - OPAQUE SOLID: Already handled above (silhouettes drawn first, then faces paint over)
        // - TRANSPARENT SOLID: All silhouettes visible ON TOP (can see through)
        // - WIREFRAME: Front-facing silhouettes only (unless culling is OFF)
        //
        if (CAMERA.render.showSilhouette && faceCount > 0) {
            const isOpaqueSolid = CAMERA.render.mode === 'solid' && CAMERA.render.solidType === 'opaque';
            
            // Skip - opaque silhouettes already drawn with proper occlusion
            if (isOpaqueSolid) {
                // Do nothing - handled above
            } else {
                const useBackfaceCull = CAMERA.backfaceCull.enabled;
                const fCount = faceCount;
                
                // INLINE: Compute front-facing state for all faces (Performance)
                // We re-compute this here because the previous computation might have been skipped 
                // or we are in a different mode branch.
                const offsetArr = faceOffsets;
                const indicesArr = faceIndices;
                const txArr = transformedX;
                const tyArr = transformedY;
                const fIsFront = faceIsFrontFacing;

                for (let i = 0; i < fCount; i++) {
                    const offset = offsetArr[i];
                    // Triangle signed area check
                    const v0 = indicesArr[offset];
                    const v1 = indicesArr[offset + 1];
                    const v2 = indicesArr[offset + 2];
                    const x0 = txArr[v0], y0 = tyArr[v0];
                    const signedArea = (txArr[v1] - x0) * (tyArr[v2] - y0) - (txArr[v2] - x0) * (tyArr[v1] - y0);
                    fIsFront[i] = signedArea > 0 ? 1 : 0;
                }
                
                ctx.beginPath();
                
                const edgeLen = edges.length;
                
                for (let i = 0; i < edgeLen; i++) {
                    const adjacentFaces = edgeToFaces[i];
                    const edge = edges[i];
                    
                    if (adjacentFaces.length === 1) {
                        // Boundary edge
                        const isFront = fIsFront[adjacentFaces[0]];
                        
                        // Strict Outline: Only show front-facing boundary edges
                        // If wireframe/transparent, we essentially want the "outline" of the volume
                        if (!isFront) continue;
                        
                        ctx.moveTo(txArr[edge[0]] | 0, tyArr[edge[0]] | 0);
                        ctx.lineTo(txArr[edge[1]] | 0, tyArr[edge[1]] | 0);

                    } else if (adjacentFaces.length === 2) {
                        const isFront1 = fIsFront[adjacentFaces[0]];
                        const isFront2 = fIsFront[adjacentFaces[1]];
                        
                        // Silhouette edge: one face front-facing, one back-facing
                        if (isFront1 !== isFront2) {
                            ctx.moveTo(txArr[edge[0]] | 0, tyArr[edge[0]] | 0);
                            ctx.lineTo(txArr[edge[1]] | 0, tyArr[edge[1]] | 0);
                        }
                    }
                }
                
                ctx.strokeStyle = FOREGROUND;
                ctx.lineWidth = 0.6;
                ctx.stroke();
            }
        }
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
    if (CAMERA.render.mode === 'solid') {
        ctx.fillText(`Solid${CAMERA.render.showEdges ? ' + Edges' : ''}`, 10, 36);
    } else if (CAMERA.backfaceCull.enabled || CAMERA.depthCull.enabled) {
        const modes = [];
        if (CAMERA.backfaceCull.enabled) modes.push('BF');
        if (CAMERA.depthCull.enabled) modes.push('Depth');
        ctx.fillText(`Cull: ${modes.join('+')}`, 10, 36);
    }
    
    requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
