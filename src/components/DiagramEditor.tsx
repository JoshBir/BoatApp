import React, { useState, useCallback, useRef, useMemo } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  Edge,
  Node,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { ComponentSidebar } from './sidebar/ComponentSidebar';
import { PropertiesPanel } from './sidebar/PropertiesPanel';
import { SimulationPanel } from './sidebar/SimulationPanel';
import { nodeTypes } from './nodes/ElectricalNodes';
import { componentSpecs } from '../data/components';
import { ComponentType, ComponentNodeData, Project } from '../types';
import { saveProject, loadAllProjects, createNewProject, deleteProject } from '../utils/storage';
import { SystemSimulation } from '../utils/simulation';
import { v4 as uuidv4 } from 'uuid';

// Rotation is handled inside node components via data.rotation property

const initialNodes: Node<ComponentNodeData>[] = [];
const initialEdges: Edge[] = [];

function DiagramEditorInner() {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selectedNode, setSelectedNode] = useState<Node<ComponentNodeData> | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<Edge | null>(null);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [showProjectModal, setShowProjectModal] = useState(true);
  const [newProjectName, setNewProjectName] = useState('');
  const [showSimulation, setShowSimulation] = useState(false);
  const [currentSimulation, setCurrentSimulation] = useState<SystemSimulation | null>(null);
  const { screenToFlowPosition } = useReactFlow();

  // Load projects on mount
  React.useEffect(() => {
    setProjects(loadAllProjects());
  }, []);

  const onConnect = useCallback(
    (params: Connection) => {
      const newEdge = {
        ...params,
        type: 'smoothstep',
        animated: true,
        style: { 
          stroke: params.sourceHandle?.includes('positive') || params.sourceHandle?.includes('pos') ? '#dc2626' : '#1d4ed8',
          strokeWidth: 2 
        },
      };
      setEdges((eds) => addEdge(newEdge, eds));
    },
    [setEdges]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const type = event.dataTransfer.getData('application/reactflow') as ComponentType;
      if (!type) return;

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const spec = componentSpecs[type];
      const newNode: Node<ComponentNodeData> = {
        id: uuidv4(),
        type,
        position,
        data: {
          spec,
          label: spec?.name || type,
          customValues: {},
          warnings: [],
          errors: [],
        },
      };

      setNodes((nds) => nds.concat(newNode));
    },
    [screenToFlowPosition, setNodes]
  );

  const onDragStart = (event: React.DragEvent, nodeType: ComponentType) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node<ComponentNodeData>) => {
    setSelectedNode(node);
    setSelectedEdge(null); // Deselect edge when node is selected
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
    setSelectedEdge(null);
  }, []);

  // Wire/Edge click handler
  const onEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    setSelectedEdge(edge);
    setSelectedNode(null); // Deselect node when edge is selected
  }, []);

  // Delete selected wire/edge
  const handleDeleteEdge = useCallback((id: string) => {
    setEdges((eds) => eds.filter((edge) => edge.id !== id));
    setSelectedEdge(null);
  }, [setEdges]);

  const handleUpdateNode = useCallback((id: string, data: Partial<ComponentNodeData>) => {
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === id) {
          return { ...node, data: { ...node.data, ...data } as ComponentNodeData };
        }
        return node;
      })
    );
    if (selectedNode?.id === id) {
      setSelectedNode((prev) => prev ? { ...prev, data: { ...prev.data, ...data } as ComponentNodeData } : null);
    }
  }, [setNodes, selectedNode]);

  const handleDeleteNode = useCallback((id: string) => {
    setNodes((nds) => nds.filter((node) => node.id !== id));
    setEdges((eds) => eds.filter((edge) => edge.source !== id && edge.target !== id));
    setSelectedNode(null);
  }, [setNodes, setEdges]);

  const handleSaveProject = useCallback(() => {
    if (!currentProject) return;
    
    const updatedProject: Project = {
      ...currentProject,
      nodes: nodes as any,
      edges: edges as any,
      updatedAt: new Date().toISOString(),
    };
    
    saveProject(updatedProject);
    setCurrentProject(updatedProject);
    setProjects(loadAllProjects());
  }, [currentProject, nodes, edges]);

  const handleNewProject = useCallback(() => {
    if (!newProjectName.trim()) return;
    
    const project = createNewProject(newProjectName.trim());
    saveProject(project);
    setCurrentProject(project);
    setNodes([]);
    setEdges([]);
    setProjects(loadAllProjects());
    setShowProjectModal(false);
    setNewProjectName('');
  }, [newProjectName, setNodes, setEdges]);

  const handleLoadProject = useCallback((project: Project) => {
    setCurrentProject(project);
    setNodes(project.nodes as any || []);
    setEdges(project.edges as any || []);
    setShowProjectModal(false);
  }, [setNodes, setEdges]);

  const handleDeleteProject = useCallback((id: string) => {
    deleteProject(id);
    setProjects(loadAllProjects());
  }, []);

  const handleExport = useCallback(() => {
    if (!currentProject) return;
    
    const projectData = {
      ...currentProject,
      nodes,
      edges,
    };
    
    const blob = new Blob([JSON.stringify(projectData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentProject.name.replace(/\s+/g, '_')}_diagram.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [currentProject, nodes, edges]);

  // Calculate system totals
  const systemTotals = useMemo(() => {
    let totalCurrent = 0;
    let totalCapacity = 0;
    let loadCount = 0;

    nodes.forEach((node) => {
      const data = node.data as ComponentNodeData;
      if (data.spec?.category === 'load') {
        totalCurrent += (data.customValues?.maxCurrent as number) || data.spec?.maxCurrent || 0;
        loadCount++;
      }
      if (data.spec?.category === 'power-source' && data.spec?.capacity) {
        totalCapacity += (data.customValues?.capacity as number) || data.spec.capacity;
      }
    });

    return { totalCurrent, totalCapacity, loadCount, componentCount: nodes.length };
  }, [nodes]);

  // Keyboard shortcuts
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSaveProject();
      }
      if (e.key === 'Delete' && selectedNode) {
        handleDeleteNode(selectedNode.id);
      }
      if (e.key === 'Delete' && selectedEdge) {
        handleDeleteEdge(selectedEdge.id);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSaveProject, handleDeleteNode, selectedNode, handleDeleteEdge, selectedEdge]);

  // Project selection modal
  if (showProjectModal) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] overflow-hidden">
          <div className="p-6 bg-marine-blue text-white">
            <h1 className="text-2xl font-bold flex items-center gap-3">
              ⚡🚢 Marine Wiring Diagram Designer
            </h1>
            <p className="text-blue-200 mt-1">Create and manage boat electrical diagrams</p>
          </div>
          
          <div className="p-6">
            {/* New Project */}
            <div className="mb-6">
              <h3 className="font-semibold text-gray-800 mb-3">Create New Project</h3>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Project name (e.g., 'My Sailboat 12V System')"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleNewProject()}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={handleNewProject}
                  disabled={!newProjectName.trim()}
                  className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  ➕ Create
                </button>
              </div>
            </div>

            {/* Templates removed: start-from-template option intentionally omitted */}

            {/* Existing Projects */}
            <div>
              <h3 className="font-semibold text-gray-800 mb-3">Open Existing Project</h3>
              {projects.length === 0 ? (
                <p className="text-gray-500 text-sm">No projects yet. Create your first one above!</p>
              ) : (
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {projects.map((project) => (
                    <div
                      key={project.id}
                      className="flex items-center justify-between p-3 border border-gray-200 rounded-md hover:bg-gray-50"
                    >
                      <div
                        className="flex-1 cursor-pointer"
                        onClick={() => handleLoadProject(project)}
                      >
                        <div className="font-medium text-gray-800">{project.name}</div>
                        <div className="text-xs text-gray-500">
                          {project.nodes?.length || 0} components • 
                          Updated: {new Date(project.updatedAt).toLocaleDateString()}
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeleteProject(project.id)}
                        className="text-red-500 hover:text-red-700 p-2"
                        title="Delete project"
                      >
                        🗑️
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="p-4 bg-gray-50 border-t text-xs text-gray-500">
            💡 Tip: Drag components from the sidebar to the canvas. Connect them by dragging from output to input handles.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header className="bg-marine-blue text-white px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-bold">⚡🚢 {currentProject?.name || 'Marine Wiring Diagram'}</h1>
          <span className="text-xs bg-blue-800 px-2 py-1 rounded">
            {systemTotals.componentCount} components • {systemTotals.loadCount} loads • {systemTotals.totalCurrent.toFixed(1)}A total
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSimulation(!showSimulation)}
            className={`px-3 py-1 rounded text-sm ${showSimulation ? 'bg-purple-600 hover:bg-purple-700' : 'bg-gray-600 hover:bg-gray-700'}`}
          >
            📊 Simulation
          </button>
          <button
            onClick={handleSaveProject}
            className="px-3 py-1 bg-green-600 hover:bg-green-700 rounded text-sm"
          >
            💾 Save (Ctrl+S)
          </button>
          <button
            onClick={handleExport}
            className="px-3 py-1 bg-purple-600 hover:bg-purple-700 rounded text-sm"
          >
            📤 Export
          </button>
          <button
            onClick={() => setShowProjectModal(true)}
            className="px-3 py-1 bg-gray-600 hover:bg-gray-700 rounded text-sm"
          >
            📁 Projects
          </button>
        </div>
      </header>

      {/* System Summary Bar */}
      <div className="bg-gray-100 px-4 py-2 flex items-center gap-6 text-sm border-b">
        <div className="flex items-center gap-2">
          <span className="text-gray-600">🔋 Battery Capacity:</span>
          <span className="font-medium">{systemTotals.totalCapacity}Ah</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-gray-600">⚡ Total Load:</span>
          <span className="font-medium">{systemTotals.totalCurrent.toFixed(1)}A</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-gray-600">⏱️ Runtime (50% DOD):</span>
          <span className="font-medium">
            {systemTotals.totalCurrent > 0 
              ? `${((systemTotals.totalCapacity * 0.5) / systemTotals.totalCurrent).toFixed(1)}h`
              : '∞'}
          </span>
        </div>
        {/* Live Simulation Stats */}
        {currentSimulation && (
          <>
            <div className="border-l border-gray-300 pl-4 flex items-center gap-2">
              <span className="text-green-600">⬆️ Gen:</span>
              <span className="font-medium text-green-700">{currentSimulation.totalGeneration.toFixed(0)}W</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-orange-600">⬇️ Load:</span>
              <span className="font-medium text-orange-700">{currentSimulation.totalLoad.toFixed(0)}W</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={currentSimulation.netPower >= 0 ? 'text-green-600' : 'text-red-600'}>
                {currentSimulation.netPower >= 0 ? '⚡ Net:' : '🔻 Net:'}
              </span>
              <span className={`font-bold ${currentSimulation.netPower >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                {currentSimulation.netPower >= 0 ? '+' : ''}{currentSimulation.netPower.toFixed(0)}W
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-blue-600">🔌 Sys:</span>
              <span className="font-mono font-medium">{currentSimulation.systemVoltage.toFixed(2)}V</span>
            </div>
          </>
        )}
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        <ComponentSidebar onDragStart={onDragStart} />
        
        <div className="flex-1" ref={reactFlowWrapper}>
          <ReactFlow
            nodes={nodes}
            edges={edges.map(edge => ({
              ...edge,
              // Highlight selected edge
              style: {
                ...edge.style,
                strokeWidth: selectedEdge?.id === edge.id ? 4 : (edge.style?.strokeWidth || 2),
                stroke: selectedEdge?.id === edge.id ? '#f59e0b' : (edge.style?.stroke || '#1d4ed8'),
              }
            }))}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onNodeClick={onNodeClick}
            onEdgeClick={onEdgeClick}
            onPaneClick={onPaneClick}
            nodeTypes={nodeTypes}
            fitView
            snapToGrid
            snapGrid={[15, 15]}
            defaultEdgeOptions={{
              type: 'smoothstep',
              animated: true,
            }}
          >
            <Controls />
            <MiniMap 
              nodeColor={(node) => {
                const data = node.data as ComponentNodeData;
                const category = data?.spec?.category;
                switch (category) {
                  case 'power-source': return '#22c55e';
                  case 'distribution': return '#3b82f6';
                  case 'protection': return '#eab308';
                  case 'charging': return '#a855f7';
                  case 'switching': return '#f97316';
                  case 'load': return '#6b7280';
                  case 'ground': return '#10b981';
                  default: return '#6b7280';
                }
              }}
            />
            <Background variant={BackgroundVariant.Dots} gap={15} size={1} />
          </ReactFlow>
        </div>

        {/* Wire/Edge Selection Panel */}
        {selectedEdge && !selectedNode && (
          <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-white rounded-lg shadow-lg border border-gray-200 p-3 flex items-center gap-3 z-50">
            <span className="text-sm text-gray-600">🔌 Wire selected</span>
            <button
              onClick={() => handleDeleteEdge(selectedEdge.id)}
              className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600 text-sm flex items-center gap-1"
            >
              🗑️ Delete Wire
            </button>
            <span className="text-xs text-gray-400">or press Delete key</span>
          </div>
        )}

        <PropertiesPanel
          selectedNode={selectedNode}
          onUpdateNode={handleUpdateNode}
          onDeleteNode={handleDeleteNode}
        />
      </div>

      {/* Simulation Panel */}
      <SimulationPanel
        nodes={nodes}
        edges={edges}
        isOpen={showSimulation}
        onToggle={() => setShowSimulation(!showSimulation)}
        onSimulationUpdate={setCurrentSimulation}
      />
    </div>
  );
}

export function DiagramEditor() {
  return (
    <ReactFlowProvider>
      <DiagramEditorInner />
    </ReactFlowProvider>
  );
}
