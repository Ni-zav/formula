const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const inputFile = process.argv[2];
if (!inputFile) {
    console.error("Usage: node model2js.js <file.obj|file.glb|file.dae|file.fbx>");
    console.error("Supported formats: .obj, .glb, .gltf, .dae, .fbx");
    process.exit(1);
}

const ext = path.extname(inputFile).toLowerCase();
const modelName = path.basename(inputFile, path.extname(inputFile));
const outputFile = path.join(__dirname, modelName + ".js");

// ============================================
// OBJ Parser (Text-based)
// ============================================
function parseOBJ(content) {
    const lines = content.split('\n');
    const vs = [];
    const fs_indices = [];

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('v ')) {
            const parts = trimmed.split(/\s+/);
            vs.push({
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
            fs_indices.push(face);
        }
    }

    return { vs, fs: fs_indices };
}

// ============================================
// GLB/glTF Parser (Pure JavaScript)
// ============================================
function parseGLB(filePath) {
    const buffer = fs.readFileSync(filePath);
    
    // Check if GLB (binary) or glTF (JSON)
    const magic = buffer.readUInt32LE(0);
    
    if (magic === 0x46546C67) { // 'glTF' in little endian
        return parseGLBBinary(buffer, filePath);
    } else {
        // It's a text glTF file
        const content = buffer.toString('utf-8');
        return parseGLTFJson(JSON.parse(content), path.dirname(filePath));
    }
}

function parseGLBBinary(buffer, filePath) {
    // GLB Header: magic (4) + version (4) + length (4) = 12 bytes
    const version = buffer.readUInt32LE(4);
    const totalLength = buffer.readUInt32LE(8);
    
    let offset = 12;
    let jsonChunk = null;
    let binChunk = null;
    
    // Read chunks
    while (offset < totalLength) {
        const chunkLength = buffer.readUInt32LE(offset);
        const chunkType = buffer.readUInt32LE(offset + 4);
        offset += 8;
        
        if (chunkType === 0x4E4F534A) { // 'JSON'
            jsonChunk = buffer.slice(offset, offset + chunkLength).toString('utf-8');
        } else if (chunkType === 0x004E4942) { // 'BIN\0'
            binChunk = buffer.slice(offset, offset + chunkLength);
        }
        
        offset += chunkLength;
    }
    
    if (!jsonChunk) {
        throw new Error("No JSON chunk found in GLB file");
    }
    
    const gltf = JSON.parse(jsonChunk);
    
    // For GLB, the binary chunk is buffer 0
    return parseGLTFJson(gltf, path.dirname(filePath), binChunk);
}

function parseGLTFJson(gltf, basePath, embeddedBin = null) {
    const vs = [];
    const fs_indices = [];
    
    // Load all buffers
    const buffers = [];
    for (let i = 0; i < (gltf.buffers || []).length; i++) {
        const bufferDef = gltf.buffers[i];
        
        if (embeddedBin && i === 0 && !bufferDef.uri) {
            // GLB embedded binary
            buffers.push(embeddedBin);
        } else if (bufferDef.uri) {
            if (bufferDef.uri.startsWith('data:')) {
                // Base64 encoded
                const base64 = bufferDef.uri.split(',')[1];
                buffers.push(Buffer.from(base64, 'base64'));
            } else {
                // External file
                const bufferPath = path.join(basePath, bufferDef.uri);
                buffers.push(fs.readFileSync(bufferPath));
            }
        }
    }
    
    // Helper to get accessor data
    function getAccessorData(accessorIndex) {
        const accessor = gltf.accessors[accessorIndex];
        const bufferView = gltf.bufferViews[accessor.bufferView];
        const buffer = buffers[bufferView.buffer];
        
        const byteOffset = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
        
        // Component type sizes
        const componentSizes = {
            5120: 1,  // BYTE
            5121: 1,  // UNSIGNED_BYTE
            5122: 2,  // SHORT
            5123: 2,  // UNSIGNED_SHORT
            5125: 4,  // UNSIGNED_INT
            5126: 4   // FLOAT
        };
        
        // Type element counts
        const typeCounts = {
            'SCALAR': 1,
            'VEC2': 2,
            'VEC3': 3,
            'VEC4': 4,
            'MAT2': 4,
            'MAT3': 9,
            'MAT4': 16
        };
        
        const componentSize = componentSizes[accessor.componentType];
        const elementCount = typeCounts[accessor.type];
        const stride = bufferView.byteStride || (componentSize * elementCount);
        
        const result = [];
        
        for (let i = 0; i < accessor.count; i++) {
            const elementOffset = byteOffset + i * stride;
            
            for (let j = 0; j < elementCount; j++) {
                const offset = elementOffset + j * componentSize;
                
                switch (accessor.componentType) {
                    case 5120: // BYTE
                        result.push(buffer.readInt8(offset));
                        break;
                    case 5121: // UNSIGNED_BYTE
                        result.push(buffer.readUInt8(offset));
                        break;
                    case 5122: // SHORT
                        result.push(buffer.readInt16LE(offset));
                        break;
                    case 5123: // UNSIGNED_SHORT
                        result.push(buffer.readUInt16LE(offset));
                        break;
                    case 5125: // UNSIGNED_INT
                        result.push(buffer.readUInt32LE(offset));
                        break;
                    case 5126: // FLOAT
                        result.push(buffer.readFloatLE(offset));
                        break;
                }
            }
        }
        
        return result;
    }
    
    let vertexOffset = 0;
    
    // Iterate through all meshes
    for (const mesh of (gltf.meshes || [])) {
        for (const primitive of (mesh.primitives || [])) {
            // Get position attribute
            if (primitive.attributes && primitive.attributes.POSITION !== undefined) {
                const positions = getAccessorData(primitive.attributes.POSITION);
                
                for (let i = 0; i < positions.length; i += 3) {
                    vs.push({
                        x: positions[i],
                        y: positions[i + 1],
                        z: positions[i + 2]
                    });
                }
                
                // Get indices
                if (primitive.indices !== undefined) {
                    const indices = getAccessorData(primitive.indices);
                    
                    for (let i = 0; i < indices.length; i += 3) {
                        fs_indices.push([
                            indices[i] + vertexOffset,
                            indices[i + 1] + vertexOffset,
                            indices[i + 2] + vertexOffset
                        ]);
                    }
                } else {
                    // No indices, sequential triangles
                    const numVertices = positions.length / 3;
                    for (let i = 0; i < numVertices; i += 3) {
                        fs_indices.push([
                            i + vertexOffset,
                            i + 1 + vertexOffset,
                            i + 2 + vertexOffset
                        ]);
                    }
                }
                
                vertexOffset += positions.length / 3;
            }
        }
    }
    
    return { vs, fs: fs_indices };
}

// ============================================
// DAE (Collada) Parser - Pure JavaScript XML
// ============================================
function parseDAE(content) {
    // Simple XML parser from scratch
    const xml = parseXML(content);
    
    const vs = [];
    const fs_indices = [];
    
    // Find COLLADA root
    const collada = findElement(xml, 'COLLADA');
    if (!collada) {
        throw new Error("Invalid DAE file: No COLLADA root element");
    }
    
    // Find library_geometries
    const libGeom = findElement(collada, 'library_geometries');
    if (!libGeom) {
        console.warn("No geometry found in DAE file");
        return { vs, fs: fs_indices };
    }
    
    // Process each geometry
    const geometries = findElements(libGeom, 'geometry');
    
    for (const geometry of geometries) {
        const mesh = findElement(geometry, 'mesh');
        if (!mesh) continue;
        
        // Build source map
        const sources = {};
        for (const source of findElements(mesh, 'source')) {
            const id = source.attributes.id;
            const floatArray = findElement(source, 'float_array');
            if (floatArray && floatArray.text) {
                sources[id] = floatArray.text.trim().split(/\s+/).map(parseFloat);
            }
        }
        
        // Find vertices element to get position source reference
        const vertices = findElement(mesh, 'vertices');
        let positionSourceId = null;
        let verticesId = null;
        
        if (vertices) {
            verticesId = vertices.attributes.id;
            const inputs = findElements(vertices, 'input');
            for (const input of inputs) {
                if (input.attributes.semantic === 'POSITION') {
                    positionSourceId = input.attributes.source.replace('#', '');
                    break;
                }
            }
        }
        
        const positionData = sources[positionSourceId] || [];
        if (positionData.length === 0) continue;
        
        // Add vertices
        const vertexOffset = vs.length;
        for (let i = 0; i < positionData.length; i += 3) {
            vs.push({
                x: positionData[i],
                y: positionData[i + 1],
                z: positionData[i + 2]
            });
        }
        
        // Parse triangles, polylist, or polygons
        const triangles = findElement(mesh, 'triangles') || 
                          findElement(mesh, 'polylist') || 
                          findElement(mesh, 'polygons');
        
        if (triangles) {
            const pElement = findElement(triangles, 'p');
            if (pElement && pElement.text) {
                const indices = pElement.text.trim().split(/\s+/).map(Number);
                
                // Find stride and vertex input offset
                const inputs = findElements(triangles, 'input');
                let stride = 1;
                let vertexInputOffset = 0;
                
                for (const input of inputs) {
                    const offset = parseInt(input.attributes.offset) || 0;
                    stride = Math.max(stride, offset + 1);
                    if (input.attributes.semantic === 'VERTEX') {
                        vertexInputOffset = offset;
                    }
                }
                
                // Handle polylist with vcount
                const vcountElement = findElement(triangles, 'vcount');
                if (vcountElement && vcountElement.text) {
                    // Polylist format
                    const vcounts = vcountElement.text.trim().split(/\s+/).map(Number);
                    let idx = 0;
                    
                    for (const vcount of vcounts) {
                        const face = [];
                        for (let v = 0; v < vcount; v++) {
                            face.push(indices[idx + vertexInputOffset] + vertexOffset);
                            idx += stride;
                        }
                        
                        // Triangulate
                        if (face.length === 3) {
                            fs_indices.push(face);
                        } else if (face.length > 3) {
                            for (let i = 1; i < face.length - 1; i++) {
                                fs_indices.push([face[0], face[i], face[i + 1]]);
                            }
                        }
                    }
                } else {
                    // Triangles format (always 3 vertices per face)
                    for (let i = 0; i < indices.length; i += stride * 3) {
                        fs_indices.push([
                            indices[i + vertexInputOffset] + vertexOffset,
                            indices[i + stride + vertexInputOffset] + vertexOffset,
                            indices[i + stride * 2 + vertexInputOffset] + vertexOffset
                        ]);
                    }
                }
            }
        }
    }
    
    return { vs, fs: fs_indices };
}

// Simple XML Parser from scratch
function parseXML(xmlString) {
    // Remove XML declaration and comments
    xmlString = xmlString.replace(/<\?xml[^?]*\?>/g, '');
    xmlString = xmlString.replace(/<!--[\s\S]*?-->/g, '');
    
    let pos = 0;
    
    function skipWhitespace() {
        while (pos < xmlString.length && /\s/.test(xmlString[pos])) {
            pos++;
        }
    }
    
    function parseElement() {
        skipWhitespace();
        
        if (pos >= xmlString.length || xmlString[pos] !== '<') {
            return null;
        }
        
        // Check for closing tag
        if (xmlString[pos + 1] === '/') {
            return null;
        }
        
        // Check for CDATA
        if (xmlString.substring(pos, pos + 9) === '<![CDATA[') {
            pos += 9;
            const endCdata = xmlString.indexOf(']]>', pos);
            const text = xmlString.substring(pos, endCdata);
            pos = endCdata + 3;
            return { type: 'text', text };
        }
        
        pos++; // Skip '<'
        
        // Read tag name
        let tagName = '';
        while (pos < xmlString.length && !/[\s\/>]/.test(xmlString[pos])) {
            tagName += xmlString[pos++];
        }
        
        // Read attributes
        const attributes = {};
        skipWhitespace();
        
        while (pos < xmlString.length && xmlString[pos] !== '>' && xmlString[pos] !== '/') {
            // Read attribute name
            let attrName = '';
            while (pos < xmlString.length && !/[\s=]/.test(xmlString[pos])) {
                attrName += xmlString[pos++];
            }
            
            skipWhitespace();
            if (xmlString[pos] === '=') {
                pos++;
                skipWhitespace();
                
                // Read attribute value
                const quote = xmlString[pos++];
                let attrValue = '';
                while (pos < xmlString.length && xmlString[pos] !== quote) {
                    attrValue += xmlString[pos++];
                }
                pos++; // Skip closing quote
                
                attributes[attrName] = attrValue;
            }
            
            skipWhitespace();
        }
        
        // Self-closing tag
        if (xmlString[pos] === '/') {
            pos += 2; // Skip '/>'
            return { name: tagName, attributes, children: [], text: '' };
        }
        
        pos++; // Skip '>'
        
        // Read children and text content
        const children = [];
        let text = '';
        
        while (pos < xmlString.length) {
            skipWhitespace();
            
            if (pos >= xmlString.length) break;
            
            // Check for closing tag
            if (xmlString[pos] === '<' && xmlString[pos + 1] === '/') {
                // Find end of closing tag
                const closeEnd = xmlString.indexOf('>', pos);
                pos = closeEnd + 1;
                break;
            }
            
            // Check for child element or CDATA
            if (xmlString[pos] === '<') {
                const child = parseElement();
                if (child) {
                    if (child.type === 'text') {
                        text += child.text;
                    } else {
                        children.push(child);
                    }
                }
            } else {
                // Text content
                let contentEnd = xmlString.indexOf('<', pos);
                if (contentEnd === -1) contentEnd = xmlString.length;
                text += xmlString.substring(pos, contentEnd);
                pos = contentEnd;
            }
        }
        
        return { name: tagName, attributes, children, text: text.trim() };
    }
    
    skipWhitespace();
    return parseElement();
}

function findElement(parent, tagName) {
    if (!parent || !parent.children) return null;
    return parent.children.find(c => c.name === tagName);
}

function findElements(parent, tagName) {
    if (!parent || !parent.children) return [];
    return parent.children.filter(c => c.name === tagName);
}

// ============================================
// FBX Parser (Binary - Pure JavaScript)
// ============================================
function parseFBX(buffer) {
    // Check if binary or ASCII
    const headerCheck = buffer.slice(0, 21).toString('ascii');
    if (!headerCheck.startsWith("Kaydara FBX Binary")) {
        return parseFBXAscii(buffer.toString('utf-8'));
    }
    
    let offset = 0;
    
    // Read helpers
    function readUint8() {
        const val = buffer.readUInt8(offset);
        offset += 1;
        return val;
    }
    
    function readUint32() {
        const val = buffer.readUInt32LE(offset);
        offset += 4;
        return val;
    }
    
    function readUint64() {
        const low = buffer.readUInt32LE(offset);
        const high = buffer.readUInt32LE(offset + 4);
        offset += 8;
        return Number(BigInt(high) * BigInt(0x100000000) + BigInt(low));
    }
    
    function readInt32() {
        const val = buffer.readInt32LE(offset);
        offset += 4;
        return val;
    }
    
    function readInt64() {
        const low = buffer.readUInt32LE(offset);
        const high = buffer.readInt32LE(offset + 4);
        offset += 8;
        return Number(BigInt(high) * BigInt(0x100000000) + BigInt(low >>> 0));
    }
    
    function readFloat32() {
        const val = buffer.readFloatLE(offset);
        offset += 4;
        return val;
    }
    
    function readFloat64() {
        const val = buffer.readDoubleLE(offset);
        offset += 8;
        return val;
    }
    
    function readString(length) {
        const str = buffer.slice(offset, offset + length).toString('utf-8');
        offset += length;
        return str;
    }
    
    function readBytes(length) {
        const bytes = buffer.slice(offset, offset + length);
        offset += length;
        return bytes;
    }
    
    // Parse header
    offset = 23; // Skip magic
    const version = readUint32();
    const is64Bit = version >= 7500;
    
    // Property type readers
    function readProperty() {
        const typeCode = String.fromCharCode(readUint8());
        
        switch (typeCode) {
            case 'Y': {
                const val = buffer.readInt16LE(offset);
                offset += 2;
                return val;
            }
            case 'C': {
                const val = buffer.readUInt8(offset) !== 0;
                offset += 1;
                return val;
            }
            case 'I': return readInt32();
            case 'F': return readFloat32();
            case 'D': return readFloat64();
            case 'L': return readInt64();
            
            case 'S': {
                const length = readUint32();
                return readString(length);
            }
            case 'R': {
                const length = readUint32();
                return readBytes(length);
            }
            
            case 'f': return readArray('float32');
            case 'd': return readArray('float64');
            case 'l': return readArray('int64');
            case 'i': return readArray('int32');
            case 'b': return readArray('bool');
            
            default:
                throw new Error(`Unknown FBX property type: ${typeCode}`);
        }
    }
    
    function readArray(type) {
        const arrayLength = readUint32();
        const encoding = readUint32();
        const compressedLength = readUint32();
        
        let data;
        if (encoding === 1) {
            const compressed = readBytes(compressedLength);
            data = zlib.inflateSync(compressed);
        } else {
            data = readBytes(compressedLength);
        }
        
        const result = [];
        let dataOffset = 0;
        
        for (let i = 0; i < arrayLength; i++) {
            switch (type) {
                case 'float32':
                    result.push(data.readFloatLE(dataOffset));
                    dataOffset += 4;
                    break;
                case 'float64':
                    result.push(data.readDoubleLE(dataOffset));
                    dataOffset += 8;
                    break;
                case 'int32':
                    result.push(data.readInt32LE(dataOffset));
                    dataOffset += 4;
                    break;
                case 'int64': {
                    const low = data.readUInt32LE(dataOffset);
                    const high = data.readInt32LE(dataOffset + 4);
                    result.push(Number(BigInt(high) * BigInt(0x100000000) + BigInt(low >>> 0)));
                    dataOffset += 8;
                    break;
                }
                case 'bool':
                    result.push(data.readUInt8(dataOffset) !== 0);
                    dataOffset += 1;
                    break;
            }
        }
        
        return result;
    }
    
    function parseNode() {
        let endOffset, numProperties, propertyListLen;
        
        if (is64Bit) {
            endOffset = readUint64();
            numProperties = readUint64();
            propertyListLen = readUint64();
        } else {
            endOffset = readUint32();
            numProperties = readUint32();
            propertyListLen = readUint32();
        }
        
        const nameLen = readUint8();
        const name = readString(nameLen);
        
        if (endOffset === 0) {
            return null;
        }
        
        const properties = [];
        for (let i = 0; i < numProperties; i++) {
            properties.push(readProperty());
        }
        
        const children = [];
        const nullRecordSize = is64Bit ? 25 : 13;
        
        while (offset < endOffset - nullRecordSize) {
            const child = parseNode();
            if (child) {
                children.push(child);
            }
        }
        
        offset = endOffset;
        
        return { name, properties, children };
    }
    
    const nodes = [];
    const nullRecordSize = is64Bit ? 25 : 13;
    
    while (offset < buffer.length - nullRecordSize) {
        const node = parseNode();
        if (node) {
            nodes.push(node);
        } else {
            break;
        }
    }
    
    return extractGeometryFromFBX(nodes);
}

function parseFBXAscii(content) {
    const vs = [];
    const fs_indices = [];
    
    const verticesMatch = content.match(/Vertices:\s*\*\d+\s*{\s*a:\s*([\d\s.,eE+-]+)/);
    const indicesMatch = content.match(/PolygonVertexIndex:\s*\*\d+\s*{\s*a:\s*([\d\s.,-]+)/);
    
    if (verticesMatch) {
        const vertexData = verticesMatch[1].split(',').map(v => parseFloat(v.trim()));
        for (let i = 0; i < vertexData.length; i += 3) {
            vs.push({
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
                    fs_indices.push([...face]);
                } else if (face.length > 3) {
                    for (let i = 1; i < face.length - 1; i++) {
                        fs_indices.push([face[0], face[i], face[i + 1]]);
                    }
                }
                face = [];
            } else {
                face.push(idx);
            }
        }
    }
    
    return { vs, fs: fs_indices };
}

function extractGeometryFromFBX(nodes) {
    const vs = [];
    const fs_indices = [];
    
    function findNodes(nodeList, name) {
        const found = [];
        for (const node of nodeList) {
            if (node.name === name) {
                found.push(node);
            }
            if (node.children) {
                found.push(...findNodes(node.children, name));
            }
        }
        return found;
    }
    
    function findChild(node, name) {
        if (!node.children) return null;
        return node.children.find(c => c.name === name);
    }
    
    const objectsNode = nodes.find(n => n.name === 'Objects');
    if (!objectsNode) {
        console.warn("No Objects node found in FBX");
        return { vs, fs: fs_indices };
    }
    
    const geometryNodes = findNodes([objectsNode], 'Geometry');
    
    for (const geom of geometryNodes) {
        if (geom.properties.length >= 3 && geom.properties[2] === 'Mesh') {
            const verticesNode = findChild(geom, 'Vertices');
            const indicesNode = findChild(geom, 'PolygonVertexIndex');
            
            const vertexOffset = vs.length;
            
            if (verticesNode && verticesNode.properties.length > 0) {
                const vertexData = verticesNode.properties[0];
                if (Array.isArray(vertexData)) {
                    for (let i = 0; i < vertexData.length; i += 3) {
                        vs.push({
                            x: vertexData[i],
                            y: vertexData[i + 1],
                            z: vertexData[i + 2]
                        });
                    }
                }
            }
            
            if (indicesNode && indicesNode.properties.length > 0) {
                const indexData = indicesNode.properties[0];
                if (Array.isArray(indexData)) {
                    let face = [];
                    for (const idx of indexData) {
                        if (idx < 0) {
                            face.push((~idx) + vertexOffset);
                            
                            if (face.length === 3) {
                                fs_indices.push([...face]);
                            } else if (face.length > 3) {
                                for (let i = 1; i < face.length - 1; i++) {
                                    fs_indices.push([face[0], face[i], face[i + 1]]);
                                }
                            }
                            face = [];
                        } else {
                            face.push(idx + vertexOffset);
                        }
                    }
                }
            }
        }
    }
    
    return { vs, fs: fs_indices };
}

// ============================================
// Center and Normalize Model (shared utility)
// Scales model to fit within targetSize (default 0.5)
// This ensures z values stay small when dz=1 is applied
// ============================================
function centerAndNormalizeModel(vs, targetSize = 0.5) {
    if (vs.length === 0) return;

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    for (const v of vs) {
        minX = Math.min(minX, v.x);
        maxX = Math.max(maxX, v.x);
        minY = Math.min(minY, v.y);
        maxY = Math.max(maxY, v.y);
        minZ = Math.min(minZ, v.z);
        maxZ = Math.max(maxZ, v.z);
    }

    // Calculate center
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;

    // Calculate the largest dimension to normalize by
    const sizeX = maxX - minX;
    const sizeY = maxY - minY;
    const sizeZ = maxZ - minZ;
    const maxDimension = Math.max(sizeX, sizeY, sizeZ);
    
    // Scale factor to fit within targetSize
    const scale = maxDimension > 0 ? targetSize / maxDimension : 1;

    // Center and normalize all vertices
    for (const v of vs) {
        v.x = (v.x - cx) * scale;
        v.y = (v.y - cy) * scale;
        v.z = (v.z - cz) * scale;
    }
    
    console.log(`  Original size: ${sizeX.toFixed(2)} x ${sizeY.toFixed(2)} x ${sizeZ.toFixed(2)}`);
    console.log(`  Scale factor: ${scale.toFixed(4)}`);
    console.log(`  Normalized to: ±${(targetSize/2).toFixed(2)}`);
}

// ============================================
// Output Generator (cube.js format)
// ============================================
function generateOutput(modelName, data) {
    return `const vs = ${JSON.stringify(data.vs, null, 4)}

const fs = ${JSON.stringify(data.fs, null, 4)}
`;
}

// ============================================
// Main Entry Point
// ============================================
function main() {
    console.log(`Converting: ${inputFile}`);
    console.log(`Format detected: ${ext.toUpperCase().slice(1)}`);

    let data;

    try {
        switch (ext) {
            case '.obj':
                const objContent = fs.readFileSync(inputFile, 'utf-8');
                data = parseOBJ(objContent);
                break;

            case '.glb':
            case '.gltf':
                data = parseGLB(inputFile);
                break;

            case '.dae':
                const daeContent = fs.readFileSync(inputFile, 'utf-8');
                data = parseDAE(daeContent);
                break;

            case '.fbx':
                const fbxBuffer = fs.readFileSync(inputFile);
                data = parseFBX(fbxBuffer);
                break;

            default:
                console.error(`Unsupported format: ${ext}`);
                console.error("Supported formats: .obj, .glb, .gltf, .dae, .fbx");
                process.exit(1);
        }

        // Center and normalize the model to fit within ±0.75
        // This ensures compatibility with the projection formula (dz=1)
        centerAndNormalizeModel(data.vs, 1.5);

        // Generate and write output
        const outputContent = generateOutput(modelName, data);
        fs.writeFileSync(outputFile, outputContent);

        console.log(`✓ Converted successfully!`);
        console.log(`  Vertices: ${data.vs.length}`);
        console.log(`  Faces: ${data.fs.length}`);
        console.log(`  Output: ${outputFile}`);

    } catch (error) {
        console.error(`Error converting ${inputFile}:`, error.message);
        process.exit(1);
    }
}

main();
