// Electrical simulation engine for marine wiring diagrams

import { Node, Edge } from '@xyflow/react';
import { ComponentNodeData, ComponentSpec } from '../types';

export interface SimulationState {
  isRunning: boolean;
  time: number; // Simulation time in seconds
  speed: number; // Simulation speed multiplier (1 = real-time)
}

export interface NodeSimState {
  voltage: number;
  current: number;
  power: number;
  state: 'on' | 'off' | 'charging' | 'discharging' | 'idle' | 'fault';
  stateOfCharge?: number; // For batteries, 0-100%
  temperature?: number; // Component temperature
  efficiency?: number; // Current efficiency
  inputVoltage?: number;
  outputVoltage?: number;
  inputCurrent?: number;
  outputCurrent?: number;
  solarInputPower?: number;
  alternatorInputPower?: number;
  // DC-DC charger specific
  chargeStage?: string; // Current charging stage (bulk, absorption, float, etc.)
  dcDcActive?: boolean; // Whether DC-DC input is active
  activationThreshold?: number; // Voltage threshold for DC-DC activation
  tempCompensation?: number; // Temperature compensation voltage adjustment
  maxOutputPower?: number; // Max output power capability
  compensatedBulkVoltage?: number; // Temperature-compensated bulk/absorption voltage
  compensatedFloatVoltage?: number; // Temperature-compensated float voltage
}

export interface ConnectionState {
  id: string;
  sourceId: string;
  targetId: string;
  voltage: number;
  current: number;
  power: number;
  voltageDrop: number;
  isActive: boolean;
}

export interface SystemSimulation {
  systemVoltage: number;
  totalLoad: number;
  totalGeneration: number;
  netPower: number; // Positive = charging, negative = discharging
  nodes: Record<string, NodeSimState>;
  connections: Record<string, ConnectionState>;
  warnings: string[];
  errors: string[];
}

// Environmental conditions that affect simulation
export interface EnvironmentState {
  solarIrradiance: number; // 0-1000 W/m² (typical peak ~1000)
  ambientTemp: number; // Celsius
  engineRunning: boolean;
  alternatorRPM: number; // 0 = engine off
  shoreConnected: boolean;
}

const DEFAULT_ENV: EnvironmentState = {
  solarIrradiance: 800, // Good sunny day
  ambientTemp: 25,
  engineRunning: false,
  alternatorRPM: 0,
  shoreConnected: false,
};

// Calculate solar panel output based on irradiance
function calculateSolarOutput(spec: ComponentSpec, irradiance: number, customValues?: Record<string, unknown>): { voltage: number; current: number; power: number } {
  const efficiencyFactor = irradiance / 1000; // Normalized to STC
  const wattage = ((customValues?.wattage as number) || spec.wattage || 100) * efficiencyFactor;
  const vmp = (customValues?.vmp as number) || spec.vmp || 18;
  const current = wattage / vmp;
  
  return {
    voltage: vmp,
    current,
    power: wattage,
  };
}

// Calculate solar array output based on configuration (series/parallel)
function calculateSolarArrayOutput(
  spec: ComponentSpec, 
  irradiance: number, 
  customValues?: Record<string, unknown>
): { voltage: number; current: number; power: number } {
  const efficiencyFactor = irradiance / 1000; // Normalized to STC
  const wattagePerPanel = ((customValues?.wattage as number) || spec.wattage || 100);
  const panelCount = (customValues?.panelCount as number) || spec.panelCount || 2;
  const arrayConfig = (customValues?.arrayConfig as string) || spec.arrayConfig || 'parallel';
  const vmp = (customValues?.vmp as number) || spec.vmp || 18;
  const imp = (customValues?.imp as number) || spec.imp || 5.56;
  
  const totalWattage = wattagePerPanel * panelCount * efficiencyFactor;
  
  let voltage: number;
  let current: number;
  
  if (arrayConfig === 'series') {
    // Series: voltages add up, current stays the same
    voltage = vmp * panelCount;
    current = imp * efficiencyFactor;
  } else {
    // Parallel: voltage stays the same, currents add up
    voltage = vmp;
    current = imp * panelCount * efficiencyFactor;
  }
  
  return {
    voltage,
    current,
    power: totalWattage,
  };
}

// Calculate alternator output based on RPM
function calculateAlternatorOutput(spec: ComponentSpec, rpm: number): { voltage: number; current: number; power: number } {
  if (rpm < 800) {
    return { voltage: 0, current: 0, power: 0 };
  }
  
  // Alternator typically provides full output above ~2000 RPM
  const outputFactor = Math.min(1, (rpm - 800) / 1200);
  const maxCurrent = spec.maxCurrent || 100;
  const current = maxCurrent * outputFactor;
  const voltage = 14.4; // Typical alternator output voltage
  
  return {
    voltage,
    current,
    power: voltage * current,
  };
}

// Battery chemistry charging profiles
interface ChargingProfile {
  bulkVoltage: number;      // Bulk/absorption voltage
  floatVoltage: number;     // Float voltage (0 if no float)
  maxDischargePercent: number; // Min recommended SoC
  maxChargeRate: number;    // Max C-rate for charging
  voltageAtFull: number;    // Resting voltage when full
  voltageAtEmpty: number;   // Resting voltage when empty
  voltageAt50: number;      // Resting voltage at 50% SoC
}

const CHARGING_PROFILES: Record<string, ChargingProfile> = {
  'lead-acid': {
    bulkVoltage: 14.4,
    floatVoltage: 13.6,
    maxDischargePercent: 50,
    maxChargeRate: 0.2,  // 20% of capacity
    voltageAtFull: 12.7,
    voltageAtEmpty: 11.8,
    voltageAt50: 12.2,
  },
  'agm': {
    bulkVoltage: 14.7,
    floatVoltage: 13.8,
    maxDischargePercent: 50,
    maxChargeRate: 0.3,  // 30% of capacity
    voltageAtFull: 12.8,
    voltageAtEmpty: 11.8,
    voltageAt50: 12.3,
  },
  'gel': {
    bulkVoltage: 14.1,
    floatVoltage: 13.5,
    maxDischargePercent: 50,
    maxChargeRate: 0.2,
    voltageAtFull: 12.8,
    voltageAtEmpty: 11.8,
    voltageAt50: 12.3,
  },
  'lithium': {
    bulkVoltage: 14.2,
    floatVoltage: 0, // No float for lithium
    maxDischargePercent: 20,
    maxChargeRate: 0.5,  // 50% of capacity
    voltageAtFull: 13.6,
    voltageAtEmpty: 12.0,
    voltageAt50: 13.2,
  },
  'lifepo4': {
    bulkVoltage: 14.2,
    floatVoltage: 0, // No float for LiFePO4
    maxDischargePercent: 10,
    maxChargeRate: 1.0,  // Can handle 1C charge rate
    voltageAtFull: 13.6,
    voltageAtEmpty: 12.0,
    voltageAt50: 13.2,
  },
};

// Get charging profile for a battery chemistry
function getChargingProfile(chemistry?: string): ChargingProfile {
  return CHARGING_PROFILES[chemistry || 'lead-acid'] || CHARGING_PROFILES['lead-acid'];
}

// Calculate battery state with chemistry-specific voltage curves
function calculateBatteryState(
  spec: ComponentSpec, 
  netCurrent: number, 
  currentSoC: number,
  deltaTime: number,
  previousState?: 'charging' | 'discharging' | 'idle'
): { voltage: number; stateOfCharge: number; state: 'charging' | 'discharging' | 'idle' } {
  const capacity = spec.capacity || 100; // Ah
  const chemistry = spec.batteryChemistry || 'lead-acid';
  const profile = getChargingProfile(chemistry);
  
  // Update state of charge
  const ahChange = (netCurrent * deltaTime) / 3600; // Convert to Ah
  let newSoC = currentSoC + (ahChange / capacity) * 100;
  newSoC = Math.max(0, Math.min(100, newSoC));
  
  // Calculate resting voltage based on SoC and chemistry
  let voltage: number;
  const isLithium = chemistry === 'lithium' || chemistry === 'lifepo4';
  
  if (isLithium) {
    // LiFePO4 has a very flat voltage curve
    if (newSoC > 95) {
      voltage = profile.voltageAtFull + (newSoC - 95) * 0.02; // Slight rise at very top
    } else if (newSoC > 15) {
      // Flat region - most of the capacity
      voltage = profile.voltageAt50 + (newSoC - 50) * 0.005;
    } else {
      // Steep drop at bottom
      voltage = profile.voltageAtEmpty + newSoC * 0.08;
    }
  } else {
    // Lead-acid/AGM/Gel - more sloped curve
    if (newSoC > 80) {
      voltage = profile.voltageAt50 + (newSoC - 50) * 0.01; // 12.2V to 12.7V+
    } else if (newSoC > 20) {
      voltage = profile.voltageAtEmpty + (newSoC - 0) * 0.015; // Linear middle region
    } else {
      voltage = profile.voltageAtEmpty - (20 - newSoC) * 0.02; // Steep drop below 20%
    }
  }
  
  // Clamp voltage to reasonable range
  voltage = Math.max(10.5, Math.min(14.6, voltage));
  
  // Use hysteresis to prevent flickering between states
  let state: 'charging' | 'discharging' | 'idle';
  const enterThreshold = 1.0;
  const exitThreshold = 0.3;
  
  if (previousState === 'charging') {
    state = netCurrent > exitThreshold ? 'charging' : (netCurrent < -exitThreshold ? 'discharging' : 'idle');
  } else if (previousState === 'discharging') {
    state = netCurrent < -exitThreshold ? 'discharging' : (netCurrent > exitThreshold ? 'charging' : 'idle');
  } else {
    state = netCurrent > enterThreshold ? 'charging' : netCurrent < -enterThreshold ? 'discharging' : 'idle';
  }
  
  return { voltage, stateOfCharge: newSoC, state };
}

// Calculate DC-DC MPPT charger state (like Renogy DCC30S)
function calculateDCDCMPPTState(
  spec: ComponentSpec,
  alternatorVoltage: number,
  solarVoltage: number,
  solarPower: number,
  batteryVoltage: number,
  batterySOC: number
): NodeSimState {
  const chargeRate = spec.chargeRate || 30;
  const maxSolarWattage = spec.maxSolarWattage || 400;
  const maxSolarCurrent = spec.maxSolarCurrent || 30;
  const efficiency = (spec.efficiency || 98) / 100;
  const altInputMin = spec.alternatorInputMin || 8;
  const altInputMax = spec.alternatorInputMax || 16;
  const solarInputMin = spec.solarInputMin || 9;
  const solarInputMax = spec.solarInputMax || 32;
  
  let alternatorInputPower = 0;
  let solarInputPowerActual = 0;
  let outputCurrent = 0;
  
  // Check alternator input
  const altValid = alternatorVoltage >= altInputMin && alternatorVoltage <= altInputMax;
  if (altValid && alternatorVoltage > batteryVoltage + 0.5) {
    // DC-DC charging from alternator
    const altCurrent = Math.min(chargeRate, (alternatorVoltage - batteryVoltage) * 5);
    alternatorInputPower = alternatorVoltage * altCurrent;
    outputCurrent += altCurrent * efficiency;
  }
  
  // Check solar input (MPPT)
  const solarValid = solarVoltage >= solarInputMin && solarVoltage <= solarInputMax;
  if (solarValid && solarPower > 0) {
    // MPPT solar charging
    solarInputPowerActual = Math.min(solarPower, maxSolarWattage);
    const solarChargeCurrent = Math.min(
      solarInputPowerActual * efficiency / batteryVoltage,
      maxSolarCurrent
    );
    outputCurrent += solarChargeCurrent;
  }
  
  // Reduce charging as battery approaches full
  if (batterySOC > 95) {
    outputCurrent *= (100 - batterySOC) / 5;
  }
  
  // Cap at max charge rate
  outputCurrent = Math.min(outputCurrent, chargeRate);
  
  const outputPower = outputCurrent * batteryVoltage;
  
  return {
    voltage: batteryVoltage,
    current: outputCurrent,
    power: outputPower,
    state: outputCurrent > 0.1 ? 'charging' : 'idle',
    efficiency: efficiency * 100,
    inputVoltage: Math.max(alternatorVoltage, solarVoltage),
    outputVoltage: batteryVoltage,
    inputCurrent: (alternatorInputPower + solarInputPowerActual) / Math.max(alternatorVoltage, solarVoltage, 1),
    outputCurrent,
    solarInputPower: solarInputPowerActual,
    alternatorInputPower,
  };
}

// Chemistry-aware DC-DC MPPT charger state calculation
// Models real DC-DC charger behavior: monitors input voltage and only charges when threshold exceeded
// Based on Renogy DCC30S (RBC30D1S) specifications
function calculateDCDCMPPTStateWithChemistry(
  spec: ComponentSpec,
  alternatorVoltage: number,
  solarVoltage: number,
  solarPower: number,
  batteryVoltage: number,
  batterySOC: number,
  batteryCapacity: number,
  batteryChemistry: string = 'lead-acid',
  starterBatteryVoltage: number = 0, // Actual starter battery voltage (used for threshold detection)
  ambientTempC: number = 25 // Ambient temperature for temp compensation
): NodeSimState {
  const chargeRate = spec.chargeRate || 30;
  const maxSolarWattage = spec.maxSolarWattage || 400;
  const maxSolarCurrent = spec.maxSolarCurrent || 30;
  const efficiency = (spec.efficiency || 94) / 100; // DCC30S: 94% efficiency
  const maxOutputPower = spec.maxOutputPower || 400; // DCC30S: 400W max output
  
  // Alternator input specs per DCC30S datasheet
  // Traditional alternator: 13.2-16V, Smart alternator (Euro 6): 12-16V
  const traditionalAltMin = spec.traditionalAltMin || 13.2;
  const altInputMin = spec.alternatorInputMin || 12; // Smart alternator min
  const altInputMax = spec.alternatorInputMax || 16;
  const maxInputVoltage = spec.maxInputVoltage || 30; // Max 30 VDC input
  
  // Solar MPPT input specs
  const solarInputMin = spec.solarInputMin || 9;
  const solarInputMax = spec.solarInputMax || 32;
  
  // Output voltage range: 9-16 VDC
  const outputVoltageMin = spec.outputVoltageMin || 9;
  const outputVoltageMax = spec.outputVoltageMax || 16;
  
  // DC-DC charger activation threshold - per DCC30S spec: 13.2V for traditional alternator
  // This means: when alternator is running, starter battery voltage rises above this
  const dcDcActivationThreshold = traditionalAltMin; // 13.2V
  
  // Temperature compensation per DCC30S spec
  // -3mV/°C/2V for non-lithium, 0mV/°C/2V for lithium
  const tempCompNonLithium = spec.tempCompNonLithium || -3; // mV per °C per 2V cell
  const tempCompLithium = spec.tempCompLithium || 0;
  
  // Get chemistry-specific charging profile
  const profile = getChargingProfile(batteryChemistry);
  const isLithium = batteryChemistry === 'lithium' || batteryChemistry === 'lifepo4';
  
  // Apply temperature compensation to charging voltage
  // 12V battery = 6 cells x 2V, so multiply by 6 for total compensation
  const tempDeltaC = ambientTempC - 25; // Reference temp is 25°C
  const tempCompMv = isLithium ? tempCompLithium : tempCompNonLithium;
  const voltageCompensation = (tempCompMv * tempDeltaC * 6) / 1000; // Convert mV to V
  
  // Calculate max charge current based on battery capacity and chemistry
  const maxChemistryChargeCurrent = batteryCapacity * profile.maxChargeRate;
  const effectiveMaxCurrent = Math.min(chargeRate, maxChemistryChargeCurrent);
  
  // Also limit by max output power (DCC30S: 400W)
  const maxCurrentByPower = maxOutputPower / batteryVoltage;
  const powerLimitedMaxCurrent = Math.min(effectiveMaxCurrent, maxCurrentByPower);
  
  let alternatorInputPower = 0;
  let solarInputPowerActual = 0;
  let outputCurrent = 0;
  let chargeStage = 'idle';
  let dcDcActive = false;
  
  // DC-DC from alternator/starter battery
  // Only activates when starter battery voltage exceeds threshold (engine running = alternator charging)
  // Per DCC30S spec: Traditional alternator 13.2-16V, Smart alternator 12-16V
  const starterVoltageForCheck = starterBatteryVoltage > 0 ? starterBatteryVoltage : alternatorVoltage;
  const inputWithinRange = alternatorVoltage >= altInputMin && alternatorVoltage <= Math.min(altInputMax, maxInputVoltage);
  
  // Output voltage must be within valid range (9-16V)
  const outputVoltageValid = batteryVoltage >= outputVoltageMin && batteryVoltage <= outputVoltageMax;
  
  if (inputWithinRange && outputVoltageValid && starterVoltageForCheck >= dcDcActivationThreshold) {
    // DC-DC activated by elevated starter battery voltage (alternator running)
    dcDcActive = true;
    const altCurrent = Math.min(powerLimitedMaxCurrent, (alternatorVoltage - batteryVoltage) * 5);
    if (altCurrent > 0) {
      alternatorInputPower = alternatorVoltage * altCurrent;
      outputCurrent += altCurrent * efficiency;
    }
  }
  
  // Check solar input (MPPT) - solar always works independently of DC-DC threshold
  const solarValid = solarVoltage >= solarInputMin && solarVoltage <= solarInputMax && outputVoltageValid;
  if (solarValid && solarPower > 0) {
    solarInputPowerActual = Math.min(solarPower, maxSolarWattage);
    const solarChargeCurrent = Math.min(
      solarInputPowerActual * efficiency / batteryVoltage,
      maxSolarCurrent,
      powerLimitedMaxCurrent - outputCurrent // Don't exceed total max current
    );
    outputCurrent += Math.max(0, solarChargeCurrent);
  }
  
  // Apply chemistry-specific charging algorithm
  // Temperature-compensated charging voltage targets (for lead-acid types)
  // Non-lithium: -3mV/°C/2V (e.g., at 35°C, reduce by 60mV per cell = -0.36V for 12V battery)
  // Lithium: No temperature compensation needed (0mV/°C/2V)
  const compensatedBulkVoltage = profile.bulkVoltage + voltageCompensation;
  const compensatedFloatVoltage = profile.floatVoltage + voltageCompensation;
  
  if (outputCurrent > 0) {
    if (isLithium) {
      // Lithium/LiFePO4: CC-CV charging, NO float stage
      // Bulk (CC): Full current until ~95% SOC or voltage reaches 14.2-14.6V
      // Absorption (CV): Hold voltage, taper current until ~100%
      // Then STOP - no float for lithium!
      if (batterySOC < 95) {
        // Bulk/CC stage - full current
        chargeStage = 'bulk (CC)';
      } else if (batterySOC < 100) {
        // CV stage - taper current as battery reaches full
        chargeStage = 'absorption (CV)';
        outputCurrent *= (100 - batterySOC) / 5;
      } else {
        // Full - stop charging completely
        chargeStage = 'full - stopped';
        outputCurrent = 0;
      }
    } else {
      // Lead-acid/AGM/Gel: 3-stage charging (Bulk -> Absorption -> Float)
      // Bulk: Max current until ~80% SOC or voltage reaches bulk voltage
      // Absorption: Hold voltage, taper current until battery accepts minimal current
      // Float: Maintain at lower voltage indefinitely (with temp compensation)
      // Compensated voltages: Bulk=${compensatedBulkVoltage.toFixed(2)}V, Float=${compensatedFloatVoltage.toFixed(2)}V
      if (batterySOC < 80) {
        // Bulk stage - max current
        chargeStage = 'bulk';
      } else if (batterySOC < 95) {
        // Absorption stage - hold voltage, taper current
        chargeStage = 'absorption';
        outputCurrent *= 0.7 + ((95 - batterySOC) / 15) * 0.3;
      } else {
        // Float stage - minimal current to maintain charge
        chargeStage = 'float';
        outputCurrent *= 0.1; // ~10% of max current in float
      }
    }
  }
  
  // Cap at power-limited max charge rate
  outputCurrent = Math.min(outputCurrent, powerLimitedMaxCurrent);
  
  const outputPower = outputCurrent * batteryVoltage;
  
  // Determine state description
  let stateStr: 'on' | 'off' | 'charging' | 'discharging' | 'idle' | 'fault' = 'idle';
  if (outputCurrent > 0.1) {
    stateStr = 'charging';
  } else if (dcDcActive || solarInputPowerActual > 0) {
    stateStr = 'on';
  }
  
  // Check for fault conditions (per DCC30S protection features)
  if (alternatorVoltage > maxInputVoltage) {
    stateStr = 'fault'; // Overvoltage protection
    chargeStage = 'overvoltage protection';
    outputCurrent = 0;
  }
  
  return {
    voltage: batteryVoltage,
    current: outputCurrent,
    power: outputPower,
    state: stateStr,
    efficiency: efficiency * 100,
    inputVoltage: Math.max(alternatorVoltage, solarVoltage),
    outputVoltage: batteryVoltage,
    inputCurrent: (alternatorInputPower + solarInputPowerActual) / Math.max(alternatorVoltage, solarVoltage, 1),
    outputCurrent,
    solarInputPower: solarInputPowerActual,
    alternatorInputPower,
    chargeStage,
    dcDcActive,
    activationThreshold: dcDcActivationThreshold,
    tempCompensation: voltageCompensation,
    maxOutputPower,
    compensatedBulkVoltage,
    compensatedFloatVoltage,
  };
}

// Main simulation function
export function runSimulation(
  nodes: Node<ComponentNodeData>[],
  edges: Edge[],
  environment: EnvironmentState = DEFAULT_ENV,
  previousState?: SystemSimulation,
  deltaTime: number = 1 // seconds
): SystemSimulation {
  const nodeStates: Record<string, NodeSimState> = {};
  const connectionStates: Record<string, ConnectionState> = {};
  const warnings: string[] = [];
  const errors: string[] = [];
  
  let systemVoltage = 12; // Default
  let totalLoad = 0;
  let totalGeneration = 0;
  
  // ============================================================
  // HELPER FUNCTIONS FOR CONNECTION TRACING
  // ============================================================
  
  // Check if a node has any connections
  const isNodeConnected = (nodeId: string): boolean => {
    return edges.some(edge => edge.source === nodeId || edge.target === nodeId);
  };
  
  // Get all directly connected node IDs (both directions)
  const getDirectConnections = (nodeId: string): string[] => {
    const connected: string[] = [];
    edges.forEach((edge) => {
      if (edge.source === nodeId) connected.push(edge.target);
      if (edge.target === nodeId) connected.push(edge.source);
    });
    return connected;
  };
  
  // Trace ALL connections through pass-through components (fuses, distribution, switching, ground)
  // Returns all non-pass-through nodes reachable from startId (each node only once)
  const traceAllConnections = (startId: string, visited: Set<string> = new Set()): Node<ComponentNodeData>[] => {
    if (visited.has(startId)) return [];
    visited.add(startId);
    
    const results: Node<ComponentNodeData>[] = [];
    const directConnections = getDirectConnections(startId);
    
    directConnections.forEach((connectedId) => {
      if (visited.has(connectedId)) return;
      
      const connectedNode = nodes.find(n => n.id === connectedId);
      if (!connectedNode) return;
      
      const cat = connectedNode.data.spec?.category;
      
      // Pass-through categories: trace through them
      if (cat === 'protection' || cat === 'distribution' || cat === 'switching' || cat === 'ground') {
        results.push(...traceAllConnections(connectedId, visited));
      } else {
        // This is a "real" component - add it to results
        // Mark as visited so we don't find it again through another path
        visited.add(connectedId);
        results.push(connectedNode);
      }
    });
    
    return results;
  };
  
  // Find all connected components of a specific type
  const findConnectedByType = (nodeId: string, types: string[]): Node<ComponentNodeData>[] => {
    const allConnected = traceAllConnections(nodeId);
    return allConnected.filter(n => types.includes(n.data.spec?.type || ''));
  };
  
  // Find all connected components of a specific category
  const findConnectedByCategory = (nodeId: string, categories: string[]): Node<ComponentNodeData>[] => {
    const allConnected = traceAllConnections(nodeId);
    return allConnected.filter(n => categories.includes(n.data.spec?.category || ''));
  };
  
  // Check if a node is connected to any battery
  const isConnectedToBattery = (nodeId: string): boolean => {
    const batteries = findConnectedByType(nodeId, ['battery', 'battery-bank', 'starter-battery', 'house-battery']);
    return batteries.length > 0;
  };
  
  // Check if a node is connected to a charger or battery (for power checking)
  const isConnectedToPower = (nodeId: string): boolean => {
    const allConnected = traceAllConnections(nodeId);
    return allConnected.some(n => 
      n.data.spec?.type === 'battery' || 
      n.data.spec?.type === 'battery-bank' ||
      n.data.spec?.type === 'starter-battery' ||
      n.data.spec?.type === 'house-battery' ||
      n.data.spec?.type === 'shore-power' ||
      n.data.spec?.type === 'alternator' ||
      n.data.spec?.category === 'charging' ||
      n.data.spec?.category === 'power-source' // Include all power sources
    );
  };
  
  // Find the first connected battery
  const findConnectedBattery = (nodeId: string): Node<ComponentNodeData> | null => {
    const batteries = findConnectedByType(nodeId, ['battery', 'battery-bank', 'starter-battery', 'house-battery']);
    return batteries[0] || null;
  };
  
  // Track power flow per battery
  const batteryCircuits: Map<string, { generation: number; load: number }> = new Map();
  // Initialize battery circuits for all batteries to avoid order-dependent updates
  nodes.forEach((n) => {
    const s = n.data.spec;
    if (s?.type === 'battery' || s?.type === 'battery-bank' || s?.type === 'starter-battery' || s?.type === 'house-battery') {
      if (!batteryCircuits.has(n.id)) {
        batteryCircuits.set(n.id, { generation: 0, load: 0 });
      }
    }
  });
  
  // ============================================================
  // FIRST PASS: Initialize power sources (batteries, solar, alternators)
  // These need to be calculated BEFORE chargers can use their values
  // ============================================================
  
  nodes.forEach((node) => {
    const spec = node.data.spec;
    if (!spec || spec.category !== 'power-source') return;
    
    const prevState = previousState?.nodes[node.id];
    const connected = isNodeConnected(node.id);
    
    switch (spec.category) {
      case 'power-source': {
        if (spec.type === 'battery' || spec.type === 'battery-bank' || spec.type === 'starter-battery' || spec.type === 'house-battery') {
          const currentSoC = prevState?.stateOfCharge ?? 80; // Start at 80%
          
          // Battery circuits already pre-initialized above - don't reset here
          // This was causing order-dependent bugs
          
          // Will be updated after load calculation
          nodeStates[node.id] = {
            voltage: prevState?.voltage || 12.8,
            current: 0,
            power: 0,
            state: connected ? 'idle' : 'idle', // State will be updated based on net power
            stateOfCharge: currentSoC,
          };
          
          systemVoltage = nodeStates[node.id].voltage;
          
        } else if (spec.type === 'solar-panel') {
          const solar = calculateSolarOutput(spec, environment.solarIrradiance, node.data.customValues);
          
          // Solar panels always produce power when there's sunlight
          // Whether it gets used depends on what they're connected to
          nodeStates[node.id] = {
            voltage: solar.voltage,
            current: solar.current,
            power: solar.power,
            state: solar.power > 0 ? 'on' : 'idle',
          };
          // Solar goes through MPPT/charger, don't add to generation directly
          
        } else if (spec.type === 'solar-array') {
          const solar = calculateSolarArrayOutput(spec, environment.solarIrradiance, node.data.customValues);
          
          // Solar arrays always produce power when there's sunlight
          nodeStates[node.id] = {
            voltage: solar.voltage,
            current: solar.current,
            power: solar.power,
            state: solar.power > 0 ? 'on' : 'idle',
          };
          // Solar goes through MPPT/charger, don't add to generation directly
          
        } else if (spec.type === 'alternator') {
          const alt = calculateAlternatorOutput(spec, environment.alternatorRPM);
          const isAltConnected = isConnectedToBattery(node.id);
          
          nodeStates[node.id] = {
            voltage: alt.voltage,
            current: (alt.power > 0 && isAltConnected) ? alt.current : 0,
            power: (alt.power > 0 && isAltConnected) ? alt.power : 0,
            state: (alt.power > 0 && isAltConnected) ? 'on' : 'idle',
          };
          
          // Only add to generation if engine running AND connected to battery/charger
          if (environment.engineRunning && isAltConnected) {
            totalGeneration += alt.power;
            // Add to ALL directly connected batteries' circuits
            // (Alternator charges starter battery, DC-DC charger handles house battery separately)
            const connectedBatteries = findConnectedByType(node.id, ['battery', 'battery-bank', 'starter-battery', 'house-battery']);
            connectedBatteries.forEach((battery) => {
              const circuit = batteryCircuits.get(battery.id);
              if (circuit) {
                // Split alternator power among directly connected batteries proportionally
                circuit.generation += alt.power / connectedBatteries.length;
              }
            });
          }
        }
        break;
      }
    }
  });
  
  // ============================================================
  // SECOND PASS: Process chargers (they need solar/alternator values from first pass)
  // ============================================================
  
  nodes.forEach((node) => {
    const spec = node.data.spec;
    if (!spec || spec.category !== 'charging') return;
    
    switch (spec.category) {
      case 'charging': {
        if (spec.type === 'dc-dc-mppt-charger') {
          // DC-DC MPPT chargers like Renogy DCC30S/DCC50S have:
          // - Alternator/starter battery INPUT (charges house battery when engine running)
          // - Solar INPUT (MPPT charging)
          // - House/aux battery OUTPUT
          
          let solarVoltage = 0;
          let solarPower = 0;
          let inputVoltage = 0; // From alternator or starter battery
          let targetBatteryVoltage = systemVoltage;
          let targetBatterySoC = 50;
          let targetBatteryId: string | null = null;
          let targetBatteryChemistry = 'lead-acid';
          let targetBatteryCapacity = 100;
          let sourceBatteryId: string | null = null;
          
          // Get ALL connected nodes
          const allConnected = traceAllConnections(node.id);
          
          // Separate batteries into potential source (starter) and target (house)
          const connectedBatteries: { 
            id: string; 
            voltage: number; 
            soc: number; 
            label: string; 
            role?: 'starter' | 'house' | 'generic';
            chemistry: string;
            capacity: number;
          }[] = [];
          
          allConnected.forEach((connectedNode) => {
            const type = connectedNode.data.spec?.type;
            const state = nodeStates[connectedNode.id];
            
            if (type === 'solar-panel' || type === 'solar-array') {
              if (state) {
                solarVoltage = Math.max(solarVoltage, state.voltage);
                solarPower += state.power;
              }
            }
            if (type === 'alternator') {
              if (state && state.voltage > inputVoltage) {
                inputVoltage = state.voltage;
              }
            }
            // Support all battery types including explicit starter-battery and house-battery
            if (type === 'battery' || type === 'battery-bank' || type === 'starter-battery' || type === 'house-battery') {
              if (state) {
                // Determine battery role: explicit type, batteryRole property, or infer from name
                const batteryRole = connectedNode.data.spec?.batteryRole;
                const batteryChemistry = (connectedNode.data.customValues?.batteryChemistry as string) || 
                                        connectedNode.data.spec?.batteryChemistry || 'lead-acid';
                const batteryCapacity = (connectedNode.data.customValues?.capacity as number) || 
                                       connectedNode.data.spec?.capacity || 100;
                const label = (connectedNode.data.label || '').toLowerCase();
                
                let role: 'starter' | 'house' | 'generic' = 'generic';
                if (type === 'starter-battery' || batteryRole === 'starter') {
                  role = 'starter';
                } else if (type === 'house-battery' || batteryRole === 'house') {
                  role = 'house';
                } else if (label.includes('starter') || label.includes('start') || label.includes('engine')) {
                  role = 'starter';
                } else if (label.includes('house') || label.includes('lithium') || label.includes('aux') || label.includes('lifepo')) {
                  role = 'house';
                }
                
                connectedBatteries.push({
                  id: connectedNode.id,
                  voltage: state.voltage,
                  soc: state.stateOfCharge || 50,
                  label: label,
                  role: role,
                  chemistry: batteryChemistry,
                  capacity: batteryCapacity,
                });
              }
            }
          });
          
          // Determine source and target batteries
          // Logic: Starter battery is the source (charged by alternator), House battery is the target
          // DC-DC activates based on starter battery voltage (threshold ~13.3V), NOT just engine running flag
          let starterBatteryVoltage = 0;
          
          if (connectedBatteries.length >= 2) {
            // Use explicit role first
            const starterBatt = connectedBatteries.find(b => b.role === 'starter');
            const houseBatt = connectedBatteries.find(b => b.role === 'house');
            
            if (starterBatt && houseBatt) {
              sourceBatteryId = starterBatt.id;
              starterBatteryVoltage = starterBatt.voltage;
              // DC-DC input voltage comes from starter battery (which is charged by alternator)
              // The DC-DC charger will use voltage threshold internally to decide if it should activate
              inputVoltage = Math.max(inputVoltage, starterBatt.voltage);
              targetBatteryId = houseBatt.id;
              targetBatteryVoltage = houseBatt.voltage;
              targetBatterySoC = houseBatt.soc;
              targetBatteryChemistry = houseBatt.chemistry;
              targetBatteryCapacity = houseBatt.capacity;
            } else {
              // Fall back to stable ID-based detection to prevent flickering
              // Sort by node ID for consistent ordering (first battery = source, second = target)
              const sorted = [...connectedBatteries].sort((a, b) => a.id.localeCompare(b.id));
              sourceBatteryId = sorted[0].id;
              starterBatteryVoltage = sorted[0].voltage;
              inputVoltage = Math.max(inputVoltage, sorted[0].voltage);
              // Use the second battery as target (or first if only one)
              const targetIdx = sorted.length > 1 ? 1 : 0;
              targetBatteryId = sorted[targetIdx].id;
              targetBatteryVoltage = sorted[targetIdx].voltage;
              targetBatterySoC = sorted[targetIdx].soc;
              targetBatteryChemistry = sorted[targetIdx].chemistry;
              targetBatteryCapacity = sorted[targetIdx].capacity;
            }
          } else if (connectedBatteries.length === 1) {
            // Single battery - it's the target, alternator/starter is the source (if connected)
            // Don't use this battery as input source - it's the output!
            targetBatteryId = connectedBatteries[0].id;
            targetBatteryVoltage = connectedBatteries[0].voltage;
            targetBatterySoC = connectedBatteries[0].soc;
            targetBatteryChemistry = connectedBatteries[0].chemistry;
            targetBatteryCapacity = connectedBatteries[0].capacity;
            // inputVoltage stays at whatever we found from alternator (or 0 if no alternator)
          }
          
          // Only charge if there's a target battery and a power source
          // Solar alone is a valid input, alternator alone is valid, or both
          const hasInput = inputVoltage > 10 || solarPower > 0;
          
          if (targetBatteryId && hasInput) {
            // Use chemistry-aware charging for proper bulk/absorption/float stages
            // Pass starterBatteryVoltage so DC-DC can use voltage threshold activation
            const dcdcState = calculateDCDCMPPTStateWithChemistry(
              spec, inputVoltage, solarVoltage, solarPower, 
              targetBatteryVoltage, targetBatterySoC,
              targetBatteryCapacity, targetBatteryChemistry,
              starterBatteryVoltage
            );
            nodeStates[node.id] = dcdcState;
            totalGeneration += dcdcState.power;
            
            // Add charging power to the TARGET battery's circuit only
            const circuit = batteryCircuits.get(targetBatteryId);
            if (circuit) {
              circuit.generation += dcdcState.power;
            }
            
            // If there's a source battery, the DC-DC draws from it (adds load to source)
            // But this is already accounted for - alternator charges starter, DC-DC charges house
          } else {
            // No target battery or no input - charger is idle
            nodeStates[node.id] = {
              voltage: 0,
              current: 0,
              power: 0,
              state: 'idle',
              efficiency: (spec.efficiency || 98),
              inputVoltage: Math.max(inputVoltage, solarVoltage),
              outputVoltage: 0,
              inputCurrent: 0,
              outputCurrent: 0,
              solarInputPower: 0,
              alternatorInputPower: 0,
            };
          }
          
        } else if (spec.type === 'dc-dc-charger') {
          const chargeRate = (node.data.customValues?.chargeRate as number) || spec.chargeRate || 20;
          const inputActive = environment.engineRunning;
          
          // Check if charger is connected to a battery
          const connectedBattery = findConnectedBattery(node.id);
          const hasBattery = connectedBattery !== null;
          
          const isCharging = inputActive && hasBattery;
          
          nodeStates[node.id] = {
            voltage: systemVoltage,
            current: isCharging ? chargeRate : 0,
            power: isCharging ? chargeRate * systemVoltage : 0,
            state: isCharging ? 'charging' : 'idle',
            efficiency: spec.efficiency || 92,
          };
          
          if (isCharging && connectedBattery) {
            totalGeneration += chargeRate * systemVoltage;
            
            // Add to connected battery circuit
            const circuit = batteryCircuits.get(connectedBattery.id);
            if (circuit) {
              circuit.generation += chargeRate * systemVoltage;
            }
          }
        }
        break;
      }
    }
  });
  
  // ============================================================
  // THIRD PASS: Process loads and other components
  // ============================================================
  
  nodes.forEach((node) => {
    const spec = node.data.spec;
    if (!spec) return;
    // Skip power sources and chargers (already processed)
    if (spec.category === 'power-source' || spec.category === 'charging') return;
    
    switch (spec.category) {
      case 'load': {
        const maxCurrent = (node.data.customValues?.maxCurrent as number) || spec.maxCurrent || 5;
        // Check if load is turned on (defaults to true if not set)
        const isOn = node.data.customValues?.isOn !== false;
        
        // CRITICAL: Only count load if it's actually powered (connected to battery or charger)
        const isPowered = isConnectedToPower(node.id);
        const isActive = isOn && isPowered;
        
        const current = isActive ? maxCurrent : 0;
        const power = current * systemVoltage;
        
        nodeStates[node.id] = {
          voltage: isPowered ? systemVoltage : 0,
          current,
          power,
          state: isActive ? 'on' : (isOn && !isPowered ? 'fault' : 'off'),
        };
        
        if (isActive) {
          totalLoad += power;
          
          // Add to connected battery circuit
          const connectedBattery = findConnectedBattery(node.id);
          if (connectedBattery) {
            const circuit = batteryCircuits.get(connectedBattery.id);
            if (circuit) {
              circuit.load += power;
            }
          }
        }
        break;
      }
      
      case 'protection': {
        // Calculate current flowing through this protection device
        // Sum up downstream loads AND upstream charging current
        const downstreamLoads = findConnectedByCategory(node.id, ['load']);
        const connectedChargers = findConnectedByCategory(node.id, ['charging']);
        
        let totalDownstreamCurrent = 0;
        let totalChargingCurrent = 0;
        
        // Sum load currents
        downstreamLoads.forEach((loadNode) => {
          const loadState = nodeStates[loadNode.id];
          if (loadState && loadState.state === 'on') {
            totalDownstreamCurrent += loadState.current;
          }
        });
        
        // Sum charging currents
        connectedChargers.forEach((chargerNode) => {
          const chargerState = nodeStates[chargerNode.id];
          if (chargerState && (chargerState.state === 'on' || chargerState.state === 'charging')) {
            totalChargingCurrent += chargerState.outputCurrent || chargerState.current || 0;
          }
        });
        
        // Current through fuse is the larger of load or charging current
        // (they flow in opposite directions, so we track the max)
        const rating = (node.data.customValues?.rating as number) || spec.rating || 15;
        const currentThrough = Math.max(totalDownstreamCurrent, totalChargingCurrent);
        const isOverloaded = currentThrough > rating;
        const isBlown = node.data.customValues?.isBlown === true;
        
        // Determine state
        let fuseState: 'on' | 'off' | 'fault' = 'on';
        if (isBlown) {
          fuseState = 'off'; // Manually marked as blown
        } else if (isOverloaded) {
          fuseState = 'fault'; // Over current - would blow in real life
        }
        
        nodeStates[node.id] = {
          voltage: fuseState === 'off' ? 0 : systemVoltage,
          current: fuseState === 'off' ? 0 : currentThrough,
          power: fuseState === 'off' ? 0 : currentThrough * systemVoltage,
          state: fuseState,
        };
        
        // Add warning if over-rated
        if (isOverloaded && !isBlown) {
          warnings.push(`${node.data.label} is over-rated: ${currentThrough.toFixed(1)}A through ${rating}A fuse!`);
        }
        break;
      }
      
      case 'distribution': {
        nodeStates[node.id] = {
          voltage: systemVoltage,
          current: 0,
          power: 0,
          state: 'on',
        };
        break;
      }
      
      case 'switching': {
        nodeStates[node.id] = {
          voltage: systemVoltage,
          current: 0,
          power: 0,
          state: 'on', // Default to closed
        };
        break;
      }
      
      default: {
        nodeStates[node.id] = {
          voltage: systemVoltage,
          current: 0,
          power: 0,
          state: 'idle',
        };
      }
    }
  });
  
  // ============================================================
  // FOURTH PASS: Update battery states based on their circuit's net power
  // ============================================================
  
  nodes.forEach((node) => {
    const spec = node.data.spec;
    if (spec?.type === 'battery' || spec?.type === 'battery-bank' || spec?.type === 'starter-battery' || spec?.type === 'house-battery') {
      const prevState = previousState?.nodes[node.id];
      const currentSoC = prevState?.stateOfCharge ?? 80;
      const previousBatteryState = prevState?.state as 'charging' | 'discharging' | 'idle' | undefined;
      
      // Get the circuit power for this specific battery
      const circuit = batteryCircuits.get(node.id);
      const connected = isNodeConnected(node.id);
      
      let netPowerForBattery = 0;
      let netCurrentForBattery = 0;
      
      if (connected && circuit) {
        netPowerForBattery = circuit.generation - circuit.load;
        netCurrentForBattery = netPowerForBattery / systemVoltage;
      }
      
      const battState = calculateBatteryState(
        { ...spec, capacity: (node.data.customValues?.capacity as number) || spec.capacity },
        netCurrentForBattery,
        currentSoC,
        deltaTime,
        previousBatteryState
      );
      
      nodeStates[node.id] = {
        ...nodeStates[node.id],
        voltage: battState.voltage,
        current: connected ? Math.abs(netCurrentForBattery) : 0,
        power: connected ? Math.abs(netPowerForBattery) : 0,
        state: connected ? battState.state : 'idle',
        stateOfCharge: battState.stateOfCharge,
      };
      
      // Only update system voltage from the first (primary) battery to prevent oscillation
      // Use the battery with the higher capacity as the reference
      const battCapacity = (node.data.customValues?.capacity as number) || spec?.capacity || 100;
      if (battCapacity >= 100 || systemVoltage === 12) {
        systemVoltage = battState.voltage;
      }
      
      // Warnings
      if (battState.stateOfCharge < 20) {
        warnings.push(`Battery ${node.data.label} is low (${battState.stateOfCharge.toFixed(0)}%)`);
      }
      if (battState.stateOfCharge < 10) {
        errors.push(`Battery ${node.data.label} critically low!`);
      }
    }
  });
  
  // ============================================================
  // Calculate connection states
  // ============================================================
  
  edges.forEach((edge) => {
    connectionStates[edge.id] = {
      id: edge.id,
      sourceId: edge.source,
      targetId: edge.target,
      voltage: systemVoltage,
      current: 0, // Would need more complex circuit analysis
      power: 0,
      voltageDrop: 0,
      isActive: true,
    };
  });
  
  // ============================================================
  // GENERATE CONNECTION WARNINGS AND RECOMMENDATIONS
  // ============================================================
  
  nodes.forEach((node) => {
    const spec = node.data.spec;
    if (!spec) return;
    
    const connected = isNodeConnected(node.id);
    const state = nodeStates[node.id];
    
    // Check for completely disconnected components
    if (!connected) {
      if (spec.category === 'power-source' && spec.type !== 'battery' && spec.type !== 'battery-bank') {
        warnings.push(`${node.data.label} is not connected to anything`);
      } else if (spec.category === 'load') {
        warnings.push(`${node.data.label} has no wire connections`);
      } else if (spec.category === 'charging') {
        warnings.push(`${node.data.label} is not wired into the system`);
      }
      return;
    }
    
    // Check for loads not connected to a battery/power source
    if (spec.category === 'load') {
      const isOn = node.data.customValues?.isOn !== false;
      if (isOn && !isConnectedToPower(node.id)) {
        warnings.push(`${node.data.label} is on but not connected to a battery`);
      }
    }
    
    // Check for solar panels not connected to chargers
    if (spec.type === 'solar-panel' || spec.type === 'solar-array') {
      const connectedChargers = findConnectedByCategory(node.id, ['charging']);
      if (connectedChargers.length === 0 && state && state.power > 0) {
        warnings.push(`${node.data.label} is producing power but not connected to a charger`);
      }
    }
    
    // Check for alternators not connected to anything useful
    if (spec.type === 'alternator') {
      const connectedBatteries = findConnectedByType(node.id, ['battery', 'battery-bank', 'starter-battery', 'house-battery']);
      const connectedChargers = findConnectedByCategory(node.id, ['charging']);
      if (connectedBatteries.length === 0 && connectedChargers.length === 0 && environment.engineRunning) {
        warnings.push(`${node.data.label} is running but not connected to a battery or charger`);
      }
    }
    
    // Check for chargers with no battery downstream
    if (spec.category === 'charging') {
      const connectedBatteries = findConnectedByType(node.id, ['battery', 'battery-bank', 'starter-battery', 'house-battery']);
      if (connectedBatteries.length === 0) {
        warnings.push(`${node.data.label} has no battery connected to charge`);
      }
    }
    
    // Check for chargers with no input source
    if (spec.type === 'dc-dc-mppt-charger') {
      const connectedSolar = findConnectedByType(node.id, ['solar-panel', 'solar-array']);
      const connectedAlt = findConnectedByType(node.id, ['alternator']);
      const connectedBatteries = findConnectedByType(node.id, ['battery', 'battery-bank', 'starter-battery', 'house-battery']);
      
      if (connectedSolar.length === 0 && connectedAlt.length === 0 && connectedBatteries.length < 2) {
        warnings.push(`${node.data.label} has no power input (solar, alternator, or starter battery)`);
      }
    }
  });
  
  // Check for batteries not connected to any loads or chargers
  nodes.forEach((node) => {
    const spec = node.data.spec;
    if ((spec?.type === 'battery' || spec?.type === 'battery-bank' || spec?.type === 'starter-battery' || spec?.type === 'house-battery') && isNodeConnected(node.id)) {
      const allConnected = traceAllConnections(node.id);
      const hasLoads = allConnected.some(n => n.data.spec?.category === 'load');
      const hasChargers = allConnected.some(n => n.data.spec?.category === 'charging');
      
      // Starter batteries should NOT have house loads connected
      if (spec?.type === 'starter-battery' || spec?.batteryRole === 'starter') {
        const hasNonStarterLoads = allConnected.some(n => {
          const loadType = n.data.spec?.type;
          // Only starter-motor and engine-related loads should be on starter battery
          return n.data.spec?.category === 'load' && loadType !== 'starter-motor' && loadType !== 'engine';
        });
        if (hasNonStarterLoads) {
          warnings.push(`⚠️ ${node.data.label} has house loads connected! Starter battery should only power starter motor.`);
        }
      }
      
      if (!hasLoads && !hasChargers) {
        warnings.push(`${node.data.label} is not connected to any loads or chargers`);
      }
    }
  });
  
  // ============================================================
  // SETUP VALIDATION - Check for configuration problems
  // ============================================================
  
  // Check for loads without protection (no fuse between battery and load)
  nodes.forEach((node) => {
    const spec = node.data.spec;
    if (spec?.category === 'load' && isNodeConnected(node.id)) {
      const allConnected = traceAllConnections(node.id);
      const hasProtection = allConnected.some(n => n.data.spec?.category === 'protection');
      const hasBattery = allConnected.some(n => 
        n.data.spec?.type === 'battery' || n.data.spec?.type === 'battery-bank' ||
        n.data.spec?.type === 'starter-battery' || n.data.spec?.type === 'house-battery'
      );
      
      if (hasBattery && !hasProtection) {
        warnings.push(`⚠️ ${node.data.label} has no fuse/breaker protection!`);
      }
    }
  });
  
  // Check for undersized fuses (fuse rating less than load current)
  nodes.forEach((node) => {
    const spec = node.data.spec;
    if (spec?.category === 'protection' && isNodeConnected(node.id)) {
      const rating = (node.data.customValues?.rating as number) || spec.rating || 15;
      const state = nodeStates[node.id];
      
      // Check if fuse is appropriately sized (should be 125% of expected load for safety margin)
      if (state && state.current > 0 && rating < state.current * 0.8) {
        // Fuse is less than 80% of load - too small even with derating
        errors.push(`❌ ${node.data.label} (${rating}A) is undersized for ${state.current.toFixed(1)}A load!`);
      }
    }
  });
  
  // Check for solar panel voltage compatibility with charger
  nodes.forEach((node) => {
    const spec = node.data.spec;
    if (spec?.category === 'charging' && spec.type === 'dc-dc-mppt-charger') {
      const connectedSolar = findConnectedByType(node.id, ['solar-panel', 'solar-array']);
      const maxSolarVoltage = spec.solarInputMax || 32;
      
      connectedSolar.forEach((solarNode) => {
        const solarSpec = solarNode.data.spec;
        const voc = (solarNode.data.customValues?.voc as number) || solarSpec?.voc || 22;
        
        if (voc > maxSolarVoltage) {
          errors.push(`❌ ${solarNode.data.label} Voc (${voc}V) exceeds ${node.data.label} max input (${maxSolarVoltage}V)!`);
        }
      });
    }
  });
  
  // Check for battery capacity vs daily load mismatch (only house batteries should be counted for house loads)
  let totalBatteryCapacity = 0;
  let totalDailyLoadAh = 0;
  
  nodes.forEach((node) => {
    const spec = node.data.spec;
    // Only count house batteries and generic batteries for capacity calculations
    // Starter batteries are reserved for engine starting
    if (spec?.type === 'battery' || spec?.type === 'battery-bank' || spec?.type === 'house-battery') {
      // Exclude starter batteries from house capacity calculations
      if (spec?.type !== 'starter-battery' && spec?.batteryRole !== 'starter') {
        const capacity = (node.data.customValues?.capacity as number) || spec.capacity || 100;
        totalBatteryCapacity += capacity;
      }
    }
    if (spec?.category === 'load') {
      const state = nodeStates[node.id];
      if (state && state.current > 0) {
        // Assume 8 hours average daily use for this warning
        totalDailyLoadAh += state.current * 8;
      }
    }
  });
  
  if (totalBatteryCapacity > 0 && totalDailyLoadAh > totalBatteryCapacity * 0.5) {
    warnings.push(`⚡ Daily load (~${totalDailyLoadAh.toFixed(0)}Ah) may exceed safe battery discharge (${(totalBatteryCapacity * 0.5).toFixed(0)}Ah at 50% DoD)`);
  }
  
  // Check for missing ground connections
  const hasGroundBus = nodes.some(n => n.data.spec?.category === 'ground');
  const hasLoads = nodes.some(n => n.data.spec?.category === 'load');
  if (hasLoads && !hasGroundBus) {
    warnings.push(`⏚ No ground/negative bus in diagram - consider adding for complete circuit`);
  }
  
  // Check for charger output exceeding battery charge rate
  nodes.forEach((node) => {
    const spec = node.data.spec;
    if (spec?.category === 'charging') {
      const chargerRate = (node.data.customValues?.chargeRate as number) || spec.chargeRate || 30;
      const connectedBatteries = findConnectedByType(node.id, ['battery', 'battery-bank', 'starter-battery', 'house-battery']);
      
      connectedBatteries.forEach((battNode) => {
        const battSpec = battNode.data.spec;
        const battCapacity = (battNode.data.customValues?.capacity as number) || battSpec?.capacity || 100;
        // Safe charge rate is typically 0.5C for lead-acid, 1C for lithium
        const isLithium = (battNode.data.label || '').toLowerCase().includes('lithium') || 
                         (battNode.data.label || '').toLowerCase().includes('lifepo');
        const maxSafeChargeRate = isLithium ? battCapacity : battCapacity * 0.5;
        
        if (chargerRate > maxSafeChargeRate) {
          warnings.push(`⚠️ ${node.data.label} (${chargerRate}A) may exceed safe charge rate for ${battNode.data.label} (${maxSafeChargeRate.toFixed(0)}A max)`);
        }
      });
    }
  });
  
  // ============================================================
  // ADDITIONAL SAFETY WARNINGS
  // ============================================================
  
  // Check for fuses approaching their limit (80%+ of rating = warning)
  nodes.forEach((node) => {
    const spec = node.data.spec;
    if (spec?.category === 'protection' && isNodeConnected(node.id)) {
      const rating = (node.data.customValues?.rating as number) || spec.rating || 15;
      const state = nodeStates[node.id];
      
      if (state && state.current > 0) {
        const loadPercent = (state.current / rating) * 100;
        if (loadPercent >= 80 && loadPercent < 100) {
          warnings.push(`⚠️ ${node.data.label} at ${loadPercent.toFixed(0)}% capacity (${state.current.toFixed(1)}A / ${rating}A)`);
        }
      }
    }
  });
  
  // Check for battery discharge rate (C-rate warning)
  nodes.forEach((node) => {
    const spec = node.data.spec;
    if ((spec?.type === 'battery' || spec?.type === 'battery-bank' || spec?.type === 'starter-battery' || spec?.type === 'house-battery') && isNodeConnected(node.id)) {
      const state = nodeStates[node.id];
      const capacity = (node.data.customValues?.capacity as number) || spec?.capacity || 100;
      const isLithium = (node.data.label || '').toLowerCase().includes('lithium') || 
                       (node.data.label || '').toLowerCase().includes('lifepo');
      
      if (state && state.state === 'discharging' && state.current > 0) {
        const cRate = state.current / capacity;
        // Lead-acid shouldn't exceed 0.2C continuous, lithium can handle 1C
        const maxCRate = isLithium ? 1.0 : 0.2;
        
        if (cRate > maxCRate) {
          warnings.push(`⚡ ${node.data.label} discharge rate (${(cRate).toFixed(2)}C) exceeds recommended ${maxCRate}C max`);
        }
      }
    }
  });
  
  // Check for solar array series voltage too high for system
  nodes.forEach((node) => {
    const spec = node.data.spec;
    if (spec?.type === 'solar-array') {
      const arrayConfig = (node.data.customValues?.arrayConfig as string) || spec.arrayConfig || 'parallel';
      const panelCount = (node.data.customValues?.panelCount as number) || spec.panelCount || 2;
      const voc = (node.data.customValues?.voc as number) || spec?.voc || 22;
      
      if (arrayConfig === 'series') {
        const totalVoc = voc * panelCount;
        // Find connected charger to check its max voltage
        const connectedChargers = findConnectedByCategory(node.id, ['charging']);
        
        connectedChargers.forEach((charger) => {
          const chargerSpec = charger.data.spec;
          const maxInput = chargerSpec?.solarInputMax || 32;
          
          if (totalVoc > maxInput) {
            errors.push(`❌ ${node.data.label} series Voc (${totalVoc}V) exceeds ${charger.data.label} max (${maxInput}V)!`);
          } else if (totalVoc > maxInput * 0.9) {
            warnings.push(`⚠️ ${node.data.label} series Voc (${totalVoc}V) close to ${charger.data.label} max (${maxInput}V)`);
          }
        });
      }
    }
  });
  
  // Check for load exceeding available generation (when no battery backup)
  if (totalLoad > 0 && totalGeneration > 0 && totalBatteryCapacity === 0) {
    if (totalLoad > totalGeneration) {
      warnings.push(`⚡ Load (${totalLoad.toFixed(0)}W) exceeds generation (${totalGeneration.toFixed(0)}W) with no battery backup!`);
    }
  }
  
  // Check for high current without appropriate wire gauge (estimate based on current)
  nodes.forEach((node) => {
    const spec = node.data.spec;
    if (spec?.category === 'load' || spec?.category === 'charging') {
      const state = nodeStates[node.id];
      if (state && state.current > 30) {
        // High current loads should have appropriately sized wiring
        warnings.push(`📏 ${node.data.label} draws ${state.current.toFixed(1)}A - ensure adequate wire gauge (≥10 AWG recommended)`);
      } else if (state && state.current > 50) {
        warnings.push(`📏 ${node.data.label} draws ${state.current.toFixed(1)}A - ensure adequate wire gauge (≥6 AWG recommended)`);
      }
    }
  });
  
  // Check for multiple batteries with mismatched voltages (parallel danger)
  // Note: Only check batteries of the same role - starter and house batteries SHOULD be on separate circuits
  const batteries = nodes.filter(n => 
    n.data.spec?.type === 'battery' || n.data.spec?.type === 'battery-bank' ||
    n.data.spec?.type === 'starter-battery' || n.data.spec?.type === 'house-battery'
  );
  
  // Group batteries by role for voltage mismatch checking
  const houseBatteries = batteries.filter(b => 
    b.data.spec?.type === 'house-battery' || 
    b.data.spec?.batteryRole === 'house' ||
    (b.data.spec?.batteryRole !== 'starter' && b.data.spec?.type !== 'starter-battery')
  );
  
  if (houseBatteries.length >= 2) {
    const batteryVoltages = houseBatteries.map(b => {
      const state = nodeStates[b.id];
      return { label: b.data.label, voltage: state?.voltage || 12 };
    });
    
    for (let i = 0; i < batteryVoltages.length; i++) {
      for (let j = i + 1; j < batteryVoltages.length; j++) {
        const diff = Math.abs(batteryVoltages[i].voltage - batteryVoltages[j].voltage);
        if (diff > 0.5) {
          warnings.push(`⚠️ Voltage mismatch: ${batteryVoltages[i].label} (${batteryVoltages[i].voltage.toFixed(2)}V) vs ${batteryVoltages[j].label} (${batteryVoltages[j].voltage.toFixed(2)}V)`);
        }
      }
    }
  }
  
  // Check for alternator connected directly to lithium without DC-DC
  nodes.forEach((node) => {
    const spec = node.data.spec;
    if (spec?.type === 'alternator' && isNodeConnected(node.id)) {
      const connectedBatteries = findConnectedByType(node.id, ['battery', 'battery-bank', 'starter-battery', 'house-battery']);
      const connectedChargers = findConnectedByCategory(node.id, ['charging']);
      
      connectedBatteries.forEach((batt) => {
        const isLithium = (batt.data.label || '').toLowerCase().includes('lithium') || 
                         (batt.data.label || '').toLowerCase().includes('lifepo');
        
        // Check if there's a DC-DC charger between alternator and lithium battery
        const hasDCDC = connectedChargers.some(c => c.data.spec?.type === 'dc-dc-charger' || c.data.spec?.type === 'dc-dc-mppt-charger');
        
        if (isLithium && !hasDCDC) {
          warnings.push(`⚠️ ${node.data.label} directly connected to ${batt.data.label} - consider DC-DC charger for lithium`);
        }
      });
    }
  });
  
  // Check for overloaded distribution bus (sum of downstream loads)
  nodes.forEach((node) => {
    const spec = node.data.spec;
    if (spec?.category === 'distribution' && isNodeConnected(node.id)) {
      const connectedLoads = findConnectedByCategory(node.id, ['load']);
      let totalBusCurrent = 0;
      
      connectedLoads.forEach((loadNode) => {
        const loadState = nodeStates[loadNode.id];
        if (loadState && loadState.state === 'on') {
          totalBusCurrent += loadState.current;
        }
      });
      
      // Typical bus bars rated for 100-150A
      const busRating = (node.data.customValues?.rating as number) || 100;
      if (totalBusCurrent > busRating) {
        errors.push(`❌ ${node.data.label} overloaded: ${totalBusCurrent.toFixed(1)}A exceeds ${busRating}A rating!`);
      } else if (totalBusCurrent > busRating * 0.8) {
        warnings.push(`⚠️ ${node.data.label} at ${((totalBusCurrent/busRating)*100).toFixed(0)}% capacity (${totalBusCurrent.toFixed(1)}A / ${busRating}A)`);
      }
    }
  });

  const netPower = totalGeneration - totalLoad;
  
  return {
    systemVoltage,
    totalLoad,
    totalGeneration,
    netPower,
    nodes: nodeStates,
    connections: connectionStates,
    warnings,
    errors,
  };
}

// Format time for display
export function formatSimTime(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
