// Tetrahedron - Simplest 3D Platonic solid (4 vertices, 4 faces)
const vs = [
    {x: 0, y: 0.35, z: 0},
    {x: -0.28, y: -0.12, z: 0.2},
    {x: 0.28, y: -0.12, z: 0.2},
    {x: 0, y: -0.12, z: -0.32}
]

const fs = [
    [0, 1], [0, 2], [0, 3],
    [1, 2], [2, 3], [3, 1]
]
