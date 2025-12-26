const fs = require('fs');
const path = require('path');

const inputFile = process.argv[2];
if (!inputFile) {
    console.error("Usage: node obj2js.js <file.obj>");
    process.exit(1);
}
const modelName = path.basename(inputFile, path.extname(inputFile));
const outputFile = modelName + ".js";

const objContent = fs.readFileSync(inputFile, 'utf-8');
const lines = objContent.split('\n');

const vs = [];
const fs_indices = [];

for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('v ')) {
        const parts = trimmed.split(/\s+/);
        // v x y z
        vs.push({
            x: parseFloat(parts[1]),
            y: parseFloat(parts[2]),
            z: parseFloat(parts[3])
        });
    } else if (trimmed.startsWith('f ')) {
        const parts = trimmed.split(/\s+/);
        // f v1/vt1/vn1 v2/vt2/vn2 ...
        const face = [];
        for (let i = 1; i < parts.length; i++) {
            const vIndex = parseInt(parts[i].split('/')[0]) - 1; // 1-based to 0-based
            face.push(vIndex);
        }
        fs_indices.push(face);
    }
}

// Center and normalize the model
const targetSize = 1.5; // Model will fit in ±0.75

if (vs.length > 0) {
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

const outputContent = `const vs = ${JSON.stringify(vs, null, 4)}

const fs = ${JSON.stringify(fs_indices, null, 4)}
`;

fs.writeFileSync(path.join(__dirname, outputFile), outputContent);
console.log(`✓ Converted ${inputFile} to ${outputFile}`);
console.log(`  Vertices: ${vs.length}`);
console.log(`  Faces: ${fs_indices.length}`);
