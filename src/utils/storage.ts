import { Project, DiagramNode, WireSpec } from '../types';
import { v4 as uuidv4 } from 'uuid';

const STORAGE_KEY = 'marine-wiring-projects';

export function saveProject(project: Project): void {
  const projects = loadAllProjects();
  const existingIndex = projects.findIndex(p => p.id === project.id);
  
  const updatedProject = {
    ...project,
    updatedAt: new Date().toISOString(),
  };

  if (existingIndex >= 0) {
    projects[existingIndex] = updatedProject;
  } else {
    projects.push(updatedProject);
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}

export function loadProject(id: string): Project | null {
  const projects = loadAllProjects();
  return projects.find(p => p.id === id) || null;
}

export function loadAllProjects(): Project[] {
  const data = localStorage.getItem(STORAGE_KEY);
  if (!data) return [];
  
  try {
    return JSON.parse(data);
  } catch {
    return [];
  }
}

export function deleteProject(id: string): void {
  const projects = loadAllProjects().filter(p => p.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}

export function createNewProject(name: string, description: string = ''): Project {
  return {
    id: uuidv4(),
    name,
    description,
    systemVoltage: 12,
    nodes: [],
    edges: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function duplicateProject(project: Project, newName?: string): Project {
  return {
    ...project,
    id: uuidv4(),
    name: newName || `${project.name} (Copy)`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function exportProjectAsJson(project: Project): string {
  return JSON.stringify(project, null, 2);
}

export function importProjectFromJson(json: string): Project | null {
  try {
    const project = JSON.parse(json);
    // Validate basic structure
    if (!project.id || !project.name || !Array.isArray(project.nodes)) {
      return null;
    }
    return {
      ...project,
      id: uuidv4(), // Generate new ID to avoid conflicts
      updatedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

// Template projects
export function getTemplateProjects(): Project[] {
  return [
    createBasicBoatTemplate(),
    createSolarSetupTemplate(),
    createDualBatteryTemplate(),
  ];
}

function createBasicBoatTemplate(): Project {
  const batteryId = uuidv4();
  const switchId = uuidv4();
  const fuseBlockId = uuidv4();
  const groundBusId = uuidv4();

  return {
    id: 'template-basic',
    name: 'Basic 12V Boat System',
    description: 'Simple single battery setup with basic loads',
    systemVoltage: 12,
    nodes: [
      {
        id: batteryId,
        type: 'battery',
        position: { x: 100, y: 200 },
        data: {
          spec: {} as any,
          label: 'House Battery',
          customValues: { capacity: 100 },
          warnings: [],
          errors: [],
        },
      },
      {
        id: switchId,
        type: 'battery-switch',
        position: { x: 250, y: 200 },
        data: {
          spec: {} as any,
          label: 'Main Switch',
          customValues: {},
          warnings: [],
          errors: [],
        },
      },
      {
        id: fuseBlockId,
        type: 'fuse-block',
        position: { x: 400, y: 200 },
        data: {
          spec: {} as any,
          label: 'Fuse Block',
          customValues: { circuits: 6 },
          warnings: [],
          errors: [],
        },
      },
      {
        id: groundBusId,
        type: 'ground-bus',
        position: { x: 250, y: 350 },
        data: {
          spec: {} as any,
          label: 'Ground Bus',
          customValues: {},
          warnings: [],
          errors: [],
        },
      },
    ],
    edges: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function createSolarSetupTemplate(): Project {
  return {
    id: 'template-solar',
    name: 'Solar Charging System',
    description: 'Solar panel with MPPT controller setup',
    systemVoltage: 12,
    nodes: [],
    edges: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function createDualBatteryTemplate(): Project {
  return {
    id: 'template-dual',
    name: 'Dual Battery with Isolator',
    description: 'Starter and house battery with charging isolator',
    systemVoltage: 12,
    nodes: [],
    edges: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
