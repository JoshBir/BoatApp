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

// Calculate battery state
function calculateBatteryState(
  spec: ComponentSpec, 
  netCurrent: number, 
  currentSoC: number,
  deltaTime: number,
  previousState?: 'charging' | 'discharging' | 'idle'
): { voltage: number; stateOfCharge: number; state: 'charging' | 'discharging' | 'idle' } {
  const capacity = spec.capacity || 100; // Ah
  
  // Update state of charge
  const ahChange = (netCurrent * deltaTime) / 3600; // Convert to Ah
  let newSoC = currentSoC + (ahChange / capacity) * 100;
  newSoC = Math.max(0, Math.min(100, newSoC));
  
  // Calculate voltage based on SoC (simplified LiFePO4 curve)
  let voltage: number;
  if (newSoC > 90) {
    voltage = 13.8 + (newSoC - 90) * 0.04; // 13.8V to 14.2V
  } else if (newSoC > 20) {
    voltage = 12.8 + (newSoC - 20) * 0.014; // 12.8V to 13.8V
  } else {
    voltage = 11.5 + newSoC * 0.065; // 11.5V to 12.8V
  }
  
  // Use hysteresis to prevent flickering between states
  // Higher threshold to enter a state, lower to exit
  let state: 'charging' | 'discharging' | 'idle';
  const enterThreshold = 0.5; // Need 0.5A to enter charging/discharging
  const exitThreshold = 0.2;  // Drop below 0.2A to go back to idle
  
  if (previousState === 'charging') {
    // Already charging - stay charging unless current drops significantly
    state = netCurrent > exitThreshold ? 'charging' : (netCurrent < -exitThreshold ? 'discharging' : 'idle');
  } else if (previousState === 'discharging') {
    // Already discharging - stay discharging unless current changes significantly
    state = netCurrent < -exitThreshold ? 'discharging' : (netCurrent > exitThreshold ? 'charging' : 'idle');
  } else {
    // Idle or unknown - need higher threshold to change state
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
    const batteries = findConnectedByType(nodeId, ['battery', 'battery-bank']);
    return batteries.length > 0;
  };
  
  // Check if a node is connected to a charger or battery (for power checking)
  const isConnectedToPower = (nodeId: string): boolean => {
    const allConnected = traceAllConnections(nodeId);
    return allConnected.some(n => 
      n.data.spec?.type === 'battery' || 
      n.data.spec?.type === 'battery-bank' ||
      n.data.spec?.category === 'charging'
    );
  };
  
  // Find the first connected battery
  const findConnectedBattery = (nodeId: string): Node<ComponentNodeData> | null => {
    const batteries = findConnectedByType(nodeId, ['battery', 'battery-bank']);
    return batteries[0] || null;
  };
  
  // Track power flow per battery
  const batteryCircuits: Map<string, { generation: number; load: number }> = new Map();
  // Initialize battery circuits for all batteries to avoid order-dependent updates
  nodes.forEach((n) => {
    const s = n.data.spec;
    if (s?.type === 'battery' || s?.type === 'battery-bank') {
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
        if (spec.type === 'battery' || spec.type === 'battery-bank') {
          const currentSoC = prevState?.stateOfCharge ?? 80; // Start at 80%
          
          // Initialize battery circuit tracking
          batteryCircuits.set(node.id, { generation: 0, load: 0 });
          
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
            const connectedBatteries = findConnectedByType(node.id, ['battery', 'battery-bank']);
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
          let sourceBatteryId: string | null = null;
          
          // Get ALL connected nodes
          const allConnected = traceAllConnections(node.id);
          
          // Separate batteries into potential source (starter) and target (house)
          const connectedBatteries: { id: string; voltage: number; soc: number; label: string }[] = [];
          
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
            if (type === 'battery' || type === 'battery-bank') {
              if (state) {
                connectedBatteries.push({
                  id: connectedNode.id,
                  voltage: state.voltage,
                  soc: state.stateOfCharge || 50,
                  label: (connectedNode.data.label || '').toLowerCase(),
                });
              }
            }
          });
          
          // Determine source and target batteries
          // Logic: If battery name contains "starter" or "start", it's the source
          // Otherwise, battery with higher SoC is source, lower SoC is target
          if (connectedBatteries.length >= 2) {
            // Try to identify by name first
            const starterBatt = connectedBatteries.find(b => 
              b.label.includes('starter') || b.label.includes('start') || b.label.includes('engine')
            );
            const houseBatt = connectedBatteries.find(b => 
              b.label.includes('house') || b.label.includes('lithium') || b.label.includes('aux') || b.label.includes('lifepo')
            );
            
            if (starterBatt && houseBatt) {
              sourceBatteryId = starterBatt.id;
              // Only use starter battery as DC-DC input if engine is running (simulates alternator charging it)
              // Otherwise DC-DC shouldn't drain the starter battery
              if (environment.engineRunning) {
                inputVoltage = Math.max(inputVoltage, starterBatt.voltage);
              }
              targetBatteryId = houseBatt.id;
              targetBatteryVoltage = houseBatt.voltage;
              targetBatterySoC = houseBatt.soc;
            } else {
              // Fall back to SoC-based detection: higher SoC = source, lower SoC = target
              const sorted = [...connectedBatteries].sort((a, b) => b.soc - a.soc);
              sourceBatteryId = sorted[0].id;
              // Only use source battery as input if engine running
              if (environment.engineRunning) {
                inputVoltage = Math.max(inputVoltage, sorted[0].voltage);
              }
              targetBatteryId = sorted[sorted.length - 1].id;
              targetBatteryVoltage = sorted[sorted.length - 1].voltage;
              targetBatterySoC = sorted[sorted.length - 1].soc;
            }
          } else if (connectedBatteries.length === 1) {
            // Single battery - it's the target, alternator/starter is the source (if connected)
            // Don't use this battery as input source - it's the output!
            targetBatteryId = connectedBatteries[0].id;
            targetBatteryVoltage = connectedBatteries[0].voltage;
            targetBatterySoC = connectedBatteries[0].soc;
            // inputVoltage stays at whatever we found from alternator (or 0 if no alternator)
          }
          
          // Only charge if there's a target battery and a power source
          // Solar alone is a valid input, alternator alone is valid, or both
          const hasInput = inputVoltage > 10 || solarPower > 0;
          
          if (targetBatteryId && hasInput) {
            const dcdcState = calculateDCDCMPPTState(
              spec, inputVoltage, solarVoltage, solarPower, targetBatteryVoltage, targetBatterySoC
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
    if (spec?.type === 'battery' || spec?.type === 'battery-bank') {
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
      
      systemVoltage = battState.voltage;
      
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
      const connectedBatteries = findConnectedByType(node.id, ['battery', 'battery-bank']);
      const connectedChargers = findConnectedByCategory(node.id, ['charging']);
      if (connectedBatteries.length === 0 && connectedChargers.length === 0 && environment.engineRunning) {
        warnings.push(`${node.data.label} is running but not connected to a battery or charger`);
      }
    }
    
    // Check for chargers with no battery downstream
    if (spec.category === 'charging') {
      const connectedBatteries = findConnectedByType(node.id, ['battery', 'battery-bank']);
      if (connectedBatteries.length === 0) {
        warnings.push(`${node.data.label} has no battery connected to charge`);
      }
    }
    
    // Check for chargers with no input source
    if (spec.type === 'dc-dc-mppt-charger') {
      const connectedSolar = findConnectedByType(node.id, ['solar-panel', 'solar-array']);
      const connectedAlt = findConnectedByType(node.id, ['alternator']);
      const connectedBatteries = findConnectedByType(node.id, ['battery', 'battery-bank']);
      
      if (connectedSolar.length === 0 && connectedAlt.length === 0 && connectedBatteries.length < 2) {
        warnings.push(`${node.data.label} has no power input (solar, alternator, or starter battery)`);
      }
    }
  });
  
  // Check for batteries not connected to any loads or chargers
  nodes.forEach((node) => {
    const spec = node.data.spec;
    if ((spec?.type === 'battery' || spec?.type === 'battery-bank') && isNodeConnected(node.id)) {
      const allConnected = traceAllConnections(node.id);
      const hasLoads = allConnected.some(n => n.data.spec?.category === 'load');
      const hasChargers = allConnected.some(n => n.data.spec?.category === 'charging');
      
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
      const hasBattery = allConnected.some(n => n.data.spec?.type === 'battery' || n.data.spec?.type === 'battery-bank');
      
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
  
  // Check for battery capacity vs daily load mismatch
  let totalBatteryCapacity = 0;
  let totalDailyLoadAh = 0;
  
  nodes.forEach((node) => {
    const spec = node.data.spec;
    if (spec?.type === 'battery' || spec?.type === 'battery-bank') {
      const capacity = (node.data.customValues?.capacity as number) || spec.capacity || 100;
      totalBatteryCapacity += capacity;
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
      const connectedBatteries = findConnectedByType(node.id, ['battery', 'battery-bank']);
      
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
    if ((spec?.type === 'battery' || spec?.type === 'battery-bank') && isNodeConnected(node.id)) {
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
  const batteries = nodes.filter(n => n.data.spec?.type === 'battery' || n.data.spec?.type === 'battery-bank');
  if (batteries.length >= 2) {
    const batteryVoltages = batteries.map(b => {
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
      const connectedBatteries = findConnectedByType(node.id, ['battery', 'battery-bank']);
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
