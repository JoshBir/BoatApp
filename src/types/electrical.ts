// Electrical component types for marine wiring diagrams

export type ComponentCategory = 
  | 'power-source'
  | 'distribution'
  | 'protection'
  | 'load'
  | 'charging'
  | 'switching'
  | 'ground';

export type ComponentType =
  // Power Sources
  | 'battery'
  | 'battery-bank'
  | 'solar-panel'
  | 'alternator'
  | 'shore-power'
  // Distribution
  | 'bus-bar'
  | 'distribution-panel'
  | 'junction-box'
  // Protection
  | 'fuse'
  | 'circuit-breaker'
  | 'fuse-block'
  | 'anl-fuse'
  | 'battery-shunt'
  // Charging
  | 'dc-dc-charger'
  | 'dc-dc-mppt-charger'
  | 'mppt-controller'
  | 'battery-charger'
  | 'isolator'
  // Switching
  | 'battery-switch'
  | 'toggle-switch'
  | 'relay'
  | 'solenoid'
  // Loads
  | 'bilge-pump'
  | 'nav-lights'
  | 'anchor-light'
  | 'cabin-lights'
  | 'radio-vhf'
  | 'chartplotter'
  | 'depth-sounder'
  | 'windlass'
  | 'refrigerator'
  | 'water-pump'
  | 'horn'
  | 'usb-outlet'
  | 'outlet-12v'
  | 'custom-load'
  // Ground
  | 'ground-bus'
  | 'bonding-bus'
  // Engine
  | 'engine'
  | 'starter-motor'
  | 'trim-pump'
  | 'diesel-heater';

export interface ComponentSpec {
  id: string;
  type: ComponentType;
  category: ComponentCategory;
  name: string;
  icon: string;
  description: string;
  // Electrical specs
  voltage: number; // Nominal voltage (typically 12V)
  maxCurrent?: number; // Max current draw in amps
  power?: number; // Power in watts
  capacity?: number; // For batteries, in Ah
  startupCurrent?: number; // Startup/inrush current in amps (for motors, heaters, etc.)
  // For fuses/breakers
  rating?: number; // Current rating in amps
  // For chargers
  chargeRate?: number; // Charge current in amps
  efficiency?: number; // Efficiency percentage
  // For DC-DC chargers with MPPT
  alternatorInputMin?: number; // Min alternator input voltage
  alternatorInputMax?: number; // Max alternator input voltage
  solarInputMin?: number; // Min solar input voltage
  solarInputMax?: number; // Max solar input voltage
  maxSolarWattage?: number; // Max solar panel wattage
  maxSolarCurrent?: number; // Max solar charging current
  batteryTypes?: string[]; // Supported battery types
  selfConsumption?: number; // Self-consumption in mA
  operatingTemp?: string; // Operating temperature range
  dimensions?: string; // Physical dimensions
  weight?: number; // Weight in kg
  // For solar panels
  wattage?: number;
  voc?: number; // Open circuit voltage
  isc?: number; // Short circuit current
  vmp?: number; // Voltage at max power
  imp?: number; // Current at max power
  // Customizable
  customizable: string[];
}

export interface WireSpec {
  id: string;
  sourceId: string;
  targetId: string;
  sourceHandle: string;
  targetHandle: string;
  wireGauge: string; // AWG
  length: number; // in feet
  color: 'red' | 'black' | 'yellow' | 'green' | 'white' | 'blue';
  current: number; // Expected current in amps
  voltageDrop: number; // Calculated voltage drop
  isAdequate: boolean; // Whether the wire is adequately sized
}

export interface DiagramNode {
  id: string;
  type: ComponentType;
  position: { x: number; y: number };
  data: ComponentNodeData;
}

export interface ComponentNodeData {
  spec: ComponentSpec;
  label: string;
  customValues: Record<string, number | string | boolean>;
  warnings: string[];
  errors: string[];
  rotation?: number; // Rotation in degrees (0, 90, 180, 270)
}

export interface Project {
  id: string;
  name: string;
  description: string;
  systemVoltage: 12 | 24 | 48;
  nodes: DiagramNode[];
  edges: WireSpec[];
  createdAt: string;
  updatedAt: string;
}

// Cable sizing chart - AWG to current capacity
export interface WireGaugeSpec {
  awg: string;
  mmSq: number;
  maxCurrent3Percent: number; // 3% voltage drop at 12V, 10ft
  maxCurrent10Percent: number; // 10% voltage drop at 12V, 10ft
  resistance: number; // Ohms per 1000ft
}

export const WIRE_GAUGES: WireGaugeSpec[] = [
  { awg: '18', mmSq: 0.82, maxCurrent3Percent: 2.5, maxCurrent10Percent: 8, resistance: 6.385 },
  { awg: '16', mmSq: 1.31, maxCurrent3Percent: 4, maxCurrent10Percent: 13, resistance: 4.016 },
  { awg: '14', mmSq: 2.08, maxCurrent3Percent: 6, maxCurrent10Percent: 20, resistance: 2.525 },
  { awg: '12', mmSq: 3.31, maxCurrent3Percent: 10, maxCurrent10Percent: 32, resistance: 1.588 },
  { awg: '10', mmSq: 5.26, maxCurrent3Percent: 15, maxCurrent10Percent: 50, resistance: 0.999 },
  { awg: '8', mmSq: 8.37, maxCurrent3Percent: 25, maxCurrent10Percent: 80, resistance: 0.628 },
  { awg: '6', mmSq: 13.3, maxCurrent3Percent: 40, maxCurrent10Percent: 120, resistance: 0.395 },
  { awg: '4', mmSq: 21.1, maxCurrent3Percent: 60, maxCurrent10Percent: 160, resistance: 0.249 },
  { awg: '2', mmSq: 33.6, maxCurrent3Percent: 95, maxCurrent10Percent: 250, resistance: 0.156 },
  { awg: '1', mmSq: 42.4, maxCurrent3Percent: 120, maxCurrent10Percent: 300, resistance: 0.124 },
  { awg: '1/0', mmSq: 53.5, maxCurrent3Percent: 150, maxCurrent10Percent: 350, resistance: 0.098 },
  { awg: '2/0', mmSq: 67.4, maxCurrent3Percent: 190, maxCurrent10Percent: 420, resistance: 0.078 },
  { awg: '3/0', mmSq: 85.0, maxCurrent3Percent: 240, maxCurrent10Percent: 500, resistance: 0.062 },
  { awg: '4/0', mmSq: 107, maxCurrent3Percent: 300, maxCurrent10Percent: 600, resistance: 0.049 },
];

// Standard fuse ratings
export const STANDARD_FUSE_RATINGS = [1, 2, 3, 5, 7.5, 10, 15, 20, 25, 30, 35, 40, 50, 60, 70, 80, 100, 125, 150, 175, 200, 225, 250, 300];

// Standard breaker ratings  
export const STANDARD_BREAKER_RATINGS = [5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 100, 125, 150, 175, 200];
