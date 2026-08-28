import React, { useRef, useMemo, useCallback, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Line, Text, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { useIsMobile } from '@/hooks/use-is-mobile';

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(
    () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  );
  React.useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

interface Node {
  id: string;
  position: THREE.Vector3;
  layer: number;
  color: string;
  type: 'supplier' | 'customer' | 'focal' | 'material' | 'product' | 'process';
  size: number;
}
interface Edge { source: string; target: string; isInterlayer: boolean; }
interface NetworkData { nodes: Node[]; edges: Edge[]; }

// Layer heights — shared everywhere (planes, labels, rectangles, nodes).
// Spacing widened a touch: process→product 2.4, product→firm 1.8.
const PROCESS_Y = 0;
const PRODUCT_Y = 2.4;
const FIRM_Y = 4.2;

// === DATA ===
const generateNetworkData = (): NetworkData => {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  // Layer positions
  const processY = PROCESS_Y;
  const productY = PRODUCT_Y;
  const firmY = FIRM_Y;

  // Global size tweak: ~20% smaller nodes
  const SIZE_SCALE = 0.8;
  // Global Z-distance scale: +20%
  const Z_SCALE = 1.2;

  const getNodeStyle = (type: Node['type']) => {
    const baseSize = 0.198 * SIZE_SCALE; // 20% smaller
    switch (type) {
      case 'supplier': return { color: '#3b82f6', size: baseSize };
      case 'customer': return { color: '#10b981', size: baseSize };
      case 'focal':    return { color: '#f59e0b', size: baseSize };
      case 'material': return { color: '#8b5cf6', size: baseSize };
      case 'product':  return { color: '#ef4444', size: baseSize };
      case 'process':  return { color: '#06b6d4', size: baseSize };
      default:         return { color: '#6b7280', size: baseSize };
    }
  };

  // Helper to push node with style
  const pushNode = (nd: { id: string; position: THREE.Vector3; type: Node['type'] }) => {
    const style = getNodeStyle(nd.type);
    nodes.push({
      id: nd.id,
      position: nd.position,
      layer: nd.position.y === processY ? 0 : nd.position.y === productY ? 1 : 2,
      color: style.color,
      type: nd.type,
      size: style.size
    });
  };

  // =========================
  // Process-level (y=0)
  // 3 suppliers, 3 materials, 2 processes, 1 product, 1 customer
  // x ordering: supplier < material < process < product < customer
  const procZs3 = [-0.9 * Z_SCALE, 0, 0.9 * Z_SCALE];
  const procZs2 = [-0.45 * Z_SCALE, 0.45 * Z_SCALE];
  const xSupplierP = -2.0;
  const xMaterialP = -1.0;
  const xProcessP  =  0.0;
  const xProductP  =  1.1;
  const xCustomerP =  2.2;

  // Suppliers (3) on process layer
  ['1','2','3'].forEach((i, idx) => pushNode({
    id: `process_supplier${i}`,
    position: new THREE.Vector3(xSupplierP, processY, procZs3[idx]),
    type: 'supplier'
  }));

  // Materials (3) on process layer
  ['1','2','3'].forEach((i, idx) => pushNode({
    id: `process_material${i}`,
    position: new THREE.Vector3(xMaterialP, processY, procZs3[idx]),
    type: 'material'
  }));

  // Processes (2) on process layer
  ['1','2'].forEach((i, idx) => pushNode({
    id: `process_process${i}`,
    position: new THREE.Vector3(xProcessP, processY, procZs2[idx]),
    type: 'process'
  }));

  // Product (1) and Customer (1) on process layer (z centered)
  pushNode({ id: 'process_product',  position: new THREE.Vector3(xProductP,  processY, 0), type: 'product'  });
  pushNode({ id: 'process_customer', position: new THREE.Vector3(xCustomerP, processY, 0), type: 'customer' });

  // === Product-level (y=PRODUCT_Y) — 3 suppliers, equally spaced in z, 1 customer ===
  const prodSupplierZs = [-0.9 * Z_SCALE, 0, 0.9 * Z_SCALE];
  const productNodes = [
    { id: 'product_material1', position: new THREE.Vector3(-0.67, productY, -1.0 * Z_SCALE), type: 'material' as const },
    { id: 'product_material2', position: new THREE.Vector3(-0.67, productY,  0.0),          type: 'material' as const },
    { id: 'product_material3', position: new THREE.Vector3(-0.67, productY,  1.0 * Z_SCALE), type: 'material' as const },
    { id: 'product_product',   position: new THREE.Vector3( 0.67, productY,  0.0),          type: 'product'  as const },
    // single customer
    { id: 'product_customer1', position: new THREE.Vector3( 2.0, productY, 0),               type: 'customer' as const }
  ];
  // 3 suppliers at equal z
  ['1','2','3'].forEach((i, idx) => pushNode({
    id: `product_supplier${i}`,
    position: new THREE.Vector3(-2.0, productY, prodSupplierZs[idx]),
    type: 'supplier'
  }));
  productNodes.forEach(nd => pushNode(nd));

  // === Firm-level (y=FIRM_Y) — 3 suppliers, equally spaced in z ===
  const firmSupplierZs = [-0.9 * Z_SCALE, 0, 0.9 * Z_SCALE];
  const firmNodes = [
    { id: 'firm_focal',    position: new THREE.Vector3( 0,   firmY,  0), type: 'focal'    as const },
    { id: 'firm_customer', position: new THREE.Vector3( 2.0, firmY,  0), type: 'customer' as const }
  ];
  ['1','2','3'].forEach((i, idx) => pushNode({
    id: `firm_supplier${i}`,
    position: new THREE.Vector3(-2.0, firmY, firmSupplierZs[idx]),
    type: 'supplier'
  }));
  firmNodes.forEach(nd => pushNode(nd));

  // === Edges ===
  // Firm layer
  ['firm_supplier1','firm_supplier2','firm_supplier3'].forEach(s => {
    edges.push({ source: s, target: 'firm_focal', isInterlayer: false });
  });
  edges.push({ source: 'firm_focal', target: 'firm_customer', isInterlayer: false });

  // Product layer
  ['product_supplier1','product_supplier2','product_supplier3'].forEach((s, idx) => {
    const targetMaterial = `product_material${idx + 1}`;
    edges.push({ source: s, target: targetMaterial, isInterlayer: false });
  });
  edges.push({ source: 'product_supplier1', target: 'product_material2', isInterlayer: false });

  edges.push({ source: 'product_material1', target: 'product_product', isInterlayer: false });
  edges.push({ source: 'product_material2', target: 'product_product', isInterlayer: false });
  edges.push({ source: 'product_material3', target: 'product_product', isInterlayer: false });
  edges.push({ source: 'product_product', target: 'product_customer1', isInterlayer: false });

  // Process layer
  ['process_supplier1','process_supplier2','process_supplier3'].forEach((s, idx) => {
    const targetMaterial = `process_material${idx + 1}`;
    edges.push({ source: s, target: targetMaterial, isInterlayer: false });
  });
  edges.push({ source: 'process_supplier1', target: 'process_material2', isInterlayer: false });

  edges.push({ source: 'process_material1', target: 'process_process1', isInterlayer: false });
  edges.push({ source: 'process_material2', target: 'process_process2', isInterlayer: false });
  edges.push({ source: 'process_material3', target: 'process_process1', isInterlayer: false });
  edges.push({ source: 'process_process1',  target: 'process_product',  isInterlayer: false });
  edges.push({ source: 'process_process2',  target: 'process_product',  isInterlayer: false });
  edges.push({ source: 'process_product',   target: 'process_customer', isInterlayer: false });

  return { nodes, edges };
};

// === R3F PARTS ===
const NetworkNode = ({ node, isHovered, onClick, reducedMotion }: { node: Node; isHovered: boolean; onClick: () => void; reducedMotion: boolean }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (!meshRef.current) return;
    meshRef.current.position.y = reducedMotion
      ? node.position.y
      : node.position.y + Math.sin(state.clock.elapsedTime + node.position.x) * 0.05;
    const targetScale = isHovered ? 1.3 : 1;
    meshRef.current.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.1);
  });
  return (
    <mesh ref={meshRef} position={[node.position.x, node.position.y, node.position.z]} onClick={onClick}>
      <sphereGeometry args={[node.size, 20, 20]} />
      <meshStandardMaterial
        color={node.color}
        emissive={node.color}
        emissiveIntensity={isHovered ? 0.4 : 0.2}
        metalness={0.1}
        roughness={0.3}
      />
    </mesh>
  );
};

const NetworkEdge = ({ edge, nodes }: { edge: Edge; nodes: Node[] }) => {
  const sourceNode = nodes.find(n => n.id === edge.source);
  const targetNode = nodes.find(n => n.id === edge.target);
  if (!sourceNode || !targetNode) return null;
  const points = [sourceNode.position, targetNode.position];
  const color = edge.isInterlayer ? '#ef4444' : '#64748b';
  const baseWidth = edge.isInterlayer ? 2 : 1;
  const baseOpacity = edge.isInterlayer ? 0.8 : 0.4;
  const lineWidth = baseWidth * 1.2;
  const opacity = Math.min(1, baseOpacity * 1.2);
  return <Line points={points} color={color} lineWidth={lineWidth} transparent opacity={opacity} />;
};

const NetworkScene = ({ reducedMotion }: { reducedMotion: boolean }) => {
  const [hoveredNode] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const networkData = useMemo(() => generateNetworkData(), []);
  const handleNodeClick = useCallback((nodeId: string) => {
    setSelectedNode(prev => (prev === nodeId ? null : nodeId));
  }, []);

  return (
    // Figure enlarged: scene scale 0.9 → 1.0
    <group scale={[1.0, 1.0, 1.0]}>
      {/* Lights */}
      <ambientLight intensity={0.6} />
      <directionalLight position={[10, 10, 5]} intensity={1} />
      <directionalLight position={[-10, -10, -5]} intensity={0.5} />

      {/* Layer planes + labels */}
      {[
        { y: PROCESS_Y, color: '#fbbf24', name: 'Process-level' },
        { y: PRODUCT_Y, color: '#8b5cf6', name: 'Product-level' },
        { y: FIRM_Y,    color: '#6b7280', name: 'Firm-level' }
      ].map((layer, index) => (
        <group key={index}>
          <mesh position={[0, layer.y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[5.4, 5.4]} />
            <meshBasicMaterial color={layer.color} transparent opacity={0.15} />
          </mesh>
          <Text
            position={[1.07, layer.y + 0.15, 2.6]}
            fontSize={0.35}
            color={layer.color}
            anchorX="center"
            anchorY="middle"
            fontWeight={700 as any}
          >
            {layer.name}
          </Text>
        </group>
      ))}

      {/* Highlight rectangle around the firm focal node */}
      <group position={[0, FIRM_Y, 0]}>
        <Line
          points={[
            new THREE.Vector3(-0.5, 0, -0.5),
            new THREE.Vector3( 0.5, 0, -0.5),
            new THREE.Vector3( 0.5, 0,  0.5),
            new THREE.Vector3(-0.5, 0,  0.5),
            new THREE.Vector3(-0.5, 0, -0.5)
          ]}
          color="#f59e0b"
          lineWidth={2.4}
        />
      </group>

      {/* Product-level rectangle */}
      <group position={[0, PRODUCT_Y, 0]}>
        <Line
          points={[
            new THREE.Vector3(-1.177, 0, -1.4),
            new THREE.Vector3( 1.177, 0, -1.4),
            new THREE.Vector3( 1.177, 0,  1.4),
            new THREE.Vector3(-1.177, 0,  1.4),
            new THREE.Vector3(-1.177, 0, -1.4)
          ]}
          color="#f59e0b"
          lineWidth={2}
        />
      </group>

      {/* Process-level rectangle */}
      <group position={[0, PROCESS_Y, 0]}>
        <Line
          points={[
            new THREE.Vector3(-1.70476, 0, -1.81424),
            new THREE.Vector3( 1.70476, 0, -1.81424),
            new THREE.Vector3( 1.70476, 0,  1.81424),
            new THREE.Vector3(-1.70476, 0,  1.81424),
            new THREE.Vector3(-1.70476, 0, -1.81424)
          ]}
          color="#f59e0b"
          lineWidth={2}
        />
      </group>

      {/* Edges */}
      {networkData.edges.map((edge, index) => (
        <NetworkEdge key={index} edge={edge} nodes={networkData.nodes} />
      ))}

      {/* Nodes */}
      {networkData.nodes.map(node => (
        <NetworkNode
          key={node.id}
          node={node}
          isHovered={hoveredNode === node.id || selectedNode === node.id}
          onClick={() => handleNodeClick(node.id)}
          reducedMotion={reducedMotion}
        />
      ))}

      {/* User interaction */}
      <OrbitControls
        enablePan
        enableZoom
        enableRotate
        minDistance={3}
        maxDistance={50}
        makeDefault
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.8}
        zoomSpeed={0.8}
        panSpeed={0.8}
      />
    </group>
  );
};

// === WRAPPER ===
const NetworkVisualization3D = () => {
  const isMobile = useIsMobile();
  const reducedMotion = usePrefersReducedMotion();
  // Widen fov and pull the camera back on mobile so the stack still fits a
  // narrow, short box; pulling the camera back (rather than rescaling the
  // scene) keeps relative proportions and label anchors correct.
  const fov = isMobile ? 64 : 50;
  const cameraZ = isMobile ? 10.4 : 8.4;

  return (
    <div className="relative w-full h-full overflow-hidden">
      <Canvas
        className="!absolute !inset-0"
        camera={{ position: [-5, 5.8, cameraZ], fov }}
        style={{ background: 'transparent' }}
        dpr={[1, 2]}
        frameloop={reducedMotion ? 'demand' : 'always'}
        gl={{
          alpha: true,
          antialias: true,
          powerPreference: "high-performance"
        }}
        onCreated={({ gl }) => {
          gl.setSize(gl.domElement.clientWidth, gl.domElement.clientHeight, false);
        }}
      >
        <NetworkScene reducedMotion={reducedMotion} />
      </Canvas>
    </div>
  );
};

export default NetworkVisualization3D;
