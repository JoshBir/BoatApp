import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Node, Edge } from '@xyflow/react';
import { ComponentNodeData } from '../../types';
import { 
  runSimulation, 
  SystemSimulation, 
  EnvironmentState, 
  formatSimTime,
  NodeSimState 
} from '../../utils/simulation';

// Monthly solar data (average peak sun hours per day) - UK/Northern Europe latitude
const MONTHLY_SOLAR_DATA: { [key: string]: { avgSunHours: number; avgIrradiance: number; avgTemp: number; sunrise: number; sunset: number; name: string; shortName: string } } = {
  '1':  { avgSunHours: 1.5, avgIrradiance: 250, avgTemp: 4,  sunrise: 8,  sunset: 16, name: 'January',   shortName: 'Jan' },
  '2':  { avgSunHours: 2.5, avgIrradiance: 350, avgTemp: 5,  sunrise: 7,  sunset: 17, name: 'February',  shortName: 'Feb' },
  '3':  { avgSunHours: 3.5, avgIrradiance: 500, avgTemp: 8,  sunrise: 6,  sunset: 18, name: 'March',     shortName: 'Mar' },
  '4':  { avgSunHours: 5.0, avgIrradiance: 650, avgTemp: 11, sunrise: 6,  sunset: 20, name: 'April',     shortName: 'Apr' },
  '5':  { avgSunHours: 6.0, avgIrradiance: 750, avgTemp: 14, sunrise: 5,  sunset: 21, name: 'May',       shortName: 'May' },
  '6':  { avgSunHours: 6.5, avgIrradiance: 800, avgTemp: 17, sunrise: 5,  sunset: 21, name: 'June',      shortName: 'Jun' },
  '7':  { avgSunHours: 6.0, avgIrradiance: 780, avgTemp: 19, sunrise: 5,  sunset: 21, name: 'July',      shortName: 'Jul' },
  '8':  { avgSunHours: 5.5, avgIrradiance: 700, avgTemp: 19, sunrise: 6,  sunset: 20, name: 'August',    shortName: 'Aug' },
  '9':  { avgSunHours: 4.0, avgIrradiance: 550, avgTemp: 16, sunrise: 7,  sunset: 19, name: 'September', shortName: 'Sep' },
  '10': { avgSunHours: 2.5, avgIrradiance: 350, avgTemp: 12, sunrise: 7,  sunset: 18, name: 'October',   shortName: 'Oct' },
  '11': { avgSunHours: 1.5, avgIrradiance: 250, avgTemp: 8,  sunrise: 7,  sunset: 16, name: 'November',  shortName: 'Nov' },
  '12': { avgSunHours: 1.0, avgIrradiance: 200, avgTemp: 5,  sunrise: 8,  sunset: 16, name: 'December',  shortName: 'Dec' },
};

// Usage time periods
type TimePeriod = 'morning' | 'afternoon' | 'evening' | 'night';
const TIME_PERIODS: { [key in TimePeriod]: { start: number; end: number; label: string } } = {
  morning:   { start: 6,  end: 12, label: '🌅 Morning (6am-12pm)' },
  afternoon: { start: 12, end: 18, label: '☀️ Afternoon (12pm-6pm)' },
  evening:   { start: 18, end: 23, label: '🌆 Evening (6pm-11pm)' },
  night:     { start: 23, end: 6,  label: '🌙 Night (11pm-6am)' },
};

// Scenario simulation types
interface LoadUsageConfig {
  nodeId: string;
  label: string;
  hoursPerDay: number;
  daysPerWeek: number;
  powerDraw: number; // Watts
  usagePeriods: TimePeriod[]; // When the load is typically used
}

interface ScenarioConfig {
  month: string;
  daysToSimulate: number;
  engineHoursPerDay: number;
  loadUsage: LoadUsageConfig[];
  simulateAllMonths: boolean; // Run for all 12 months
  location: 'uk' | 'mediterranean' | 'northern' | 'tropical'; // Affects solar data
}

interface ScenarioResult {
  day: number;
  hour: number;
  batterySOC: number;
  solarGeneration: number;
  loadConsumption: number;
  alternatorGeneration: number;
  netPower: number;
}

interface MonthlyResult {
  month: string;
  monthName: string;
  minSOC: number;
  maxSOC: number;
  avgSOC: number;
  totalSolarGenerated: number;
  totalConsumed: number;
  daysBelow20: number;
  sustainable: boolean;
}

interface ScenarioSummary {
  results: ScenarioResult[];
  monthlyResults?: MonthlyResult[]; // For yearly simulation
  minSOC: number;
  maxSOC: number;
  avgSOC: number;
  totalSolarGenerated: number;
  totalConsumed: number;
  totalAlternatorGenerated: number;
  daysBelow20: number;
  sustainable: boolean;
  recommendation: string;
  worstMonth?: string;
  bestMonth?: string;
}

// Calculate time estimates for charging
interface ChargeSummary {
  totalBatteryCapacity: number; // Ah
  currentSoC: number; // Average %
  averageChargeCurrent: number; // A
  averageLoadCurrent: number; // A
  netChargeCurrent: number; // A
  timeToFull: number | null; // seconds, null if not charging
  timeToEmpty: number | null; // seconds, null if not discharging
  dailySolarYield: number; // Wh
  runtime: number; // seconds at current load
  batteryCount: number;
}

function calculateChargeSummary(
  nodes: Node<ComponentNodeData>[],
  simulation: SystemSimulation | null,
  environment: EnvironmentState
): ChargeSummary {
  if (!simulation) {
    return {
      totalBatteryCapacity: 0,
      currentSoC: 0,
      averageChargeCurrent: 0,
      averageLoadCurrent: 0,
      netChargeCurrent: 0,
      timeToFull: null,
      timeToEmpty: null,
      dailySolarYield: 0,
      runtime: 0,
      batteryCount: 0,
    };
  }

  let totalCapacity = 0;
  let totalAhRemaining = 0;
  let batteryCount = 0;
  
  // Calculate battery stats
  nodes.forEach((node) => {
    const spec = node.data.spec;
    if (spec?.type === 'battery' || spec?.type === 'battery-bank') {
      const capacity = (node.data.customValues?.capacity as number) || spec.capacity || 100;
      const state = simulation.nodes[node.id];
      const soc = state?.stateOfCharge ?? 80;
      
      totalCapacity += capacity;
      totalAhRemaining += capacity * (soc / 100);
      batteryCount++;
    }
  });
  
  const currentSoC = totalCapacity > 0 ? (totalAhRemaining / totalCapacity) * 100 : 0;
  const ahToFull = totalCapacity - totalAhRemaining;
  const ahToEmpty = totalAhRemaining * 0.8; // Don't drain below 20%
  
  // Current rates
  const netPower = simulation.netPower;
  const netCurrent = netPower / simulation.systemVoltage;
  const chargeCurrent = simulation.totalGeneration / simulation.systemVoltage;
  const loadCurrent = simulation.totalLoad / simulation.systemVoltage;
  
  // Time calculations
  let timeToFull: number | null = null;
  let timeToEmpty: number | null = null;
  
  if (netCurrent > 0.1 && ahToFull > 0) {
    // Charging - account for absorption phase slowdown
    const avgChargeEfficiency = currentSoC > 80 ? 0.5 : currentSoC > 90 ? 0.2 : 1;
    timeToFull = (ahToFull / (netCurrent * avgChargeEfficiency)) * 3600;
  }
  
  if (netCurrent < -0.1 && ahToEmpty > 0) {
    // Discharging
    timeToEmpty = (ahToEmpty / Math.abs(netCurrent)) * 3600;
  }
  
  // Estimate daily solar yield (assuming average 5 peak sun hours)
  const solarPower = simulation.totalGeneration;
  const dailySolarYield = solarPower * 5; // Wh per day estimate
  
  // Runtime at current load (if no charging)
  const runtime = loadCurrent > 0 ? (ahToEmpty / loadCurrent) * 3600 : 0;
  
  return {
    totalBatteryCapacity: totalCapacity,
    currentSoC,
    averageChargeCurrent: chargeCurrent,
    averageLoadCurrent: loadCurrent,
    netChargeCurrent: netCurrent,
    timeToFull,
    timeToEmpty,
    dailySolarYield,
    runtime,
    batteryCount,
  };
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || !isFinite(seconds) || seconds <= 0) return '--';
  
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return `${days}d ${remainingHours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${mins}m`;
  }
  return `${mins}m`;
}

// Location-based solar multipliers
const LOCATION_MULTIPLIERS: { [key: string]: { solar: number; name: string } } = {
  'uk': { solar: 1.0, name: 'UK / Northern Europe' },
  'mediterranean': { solar: 1.4, name: 'Mediterranean' },
  'northern': { solar: 0.7, name: 'Scandinavia / Scotland' },
  'tropical': { solar: 1.6, name: 'Tropical / Caribbean' },
};

// Check if an hour falls within a time period
function isHourInPeriod(hour: number, period: TimePeriod): boolean {
  const p = TIME_PERIODS[period];
  if (period === 'night') {
    return hour >= p.start || hour < p.end;
  }
  return hour >= p.start && hour < p.end;
}

// Run simulation for a single month
function runMonthSimulation(
  nodes: Node<ComponentNodeData>[],
  config: ScenarioConfig,
  monthKey: string,
  totalBatteryCapacity: number,
  totalSolarCapacity: number,
  dcDcCapacity: number,
  alternatorCapacity: number,
  initialSOC: number = 80
): { results: ScenarioResult[]; monthResult: MonthlyResult; finalSOC: number } {
  const monthData = MONTHLY_SOLAR_DATA[monthKey];
  const locationMultiplier = LOCATION_MULTIPLIERS[config.location]?.solar || 1.0;
  const results: ScenarioResult[] = [];
  
  let currentSOC = initialSOC;
  let totalSolarGenerated = 0;
  let totalConsumed = 0;
  let totalAlternatorGenerated = 0;
  let minSOC = 100;
  let maxSOC = 0;
  let daysBelow20 = 0;
  let totalSOC = 0;
  let dataPoints = 0;
  
  const systemVoltage = 12.6;
  const sunriseHour = monthData.sunrise;
  const sunsetHour = monthData.sunset;
  
  // Simulate each day
  for (let day = 0; day < config.daysToSimulate; day++) {
    let dayHitBelow20 = false;
    const dayOfWeek = day % 7;
    
    // Simulate each hour
    for (let hour = 0; hour < 24; hour++) {
      // Calculate solar generation for this hour
      let solarGeneration = 0;
      
      if (hour >= sunriseHour && hour < sunsetHour) {
        // Bell curve for solar (peaks at solar noon)
        const solarNoon = (sunriseHour + sunsetHour) / 2;
        const solarDuration = sunsetHour - sunriseHour;
        const hourFromNoon = Math.abs(hour - solarNoon);
        const solarFactor = Math.max(0, Math.cos((hourFromNoon / (solarDuration / 2)) * (Math.PI / 2)));
        const irradianceFactor = (monthData.avgIrradiance / 1000) * locationMultiplier;
        solarGeneration = totalSolarCapacity * solarFactor * irradianceFactor * 0.85; // 85% system efficiency
      }
      
      // Calculate load consumption for this hour
      let loadConsumption = 0;
      config.loadUsage.forEach((loadConfig) => {
        // Check if this load is used on this day of week
        const usageDaysPerWeek = loadConfig.daysPerWeek || 7;
        const isActiveDay = dayOfWeek < usageDaysPerWeek;
        
        if (!isActiveDay) return;
        
        // Check if this hour falls within the load's usage periods
        const isInUsagePeriod = loadConfig.usagePeriods.some(period => isHourInPeriod(hour, period));
        if (!isInUsagePeriod) return;
        
        // Calculate probability of being active this hour
        const totalPeriodHours = loadConfig.usagePeriods.reduce((sum, period) => {
          const p = TIME_PERIODS[period];
          if (period === 'night') {
            return sum + (24 - p.start) + p.end;
          }
          return sum + (p.end - p.start);
        }, 0);
        
        const probabilityActive = Math.min(loadConfig.hoursPerDay / Math.max(totalPeriodHours, 1), 1);
        
        // Deterministic calculation based on hour position (avoid randomness for consistent results)
        const hourProgress = hour / 24;
        const dayProgress = day / config.daysToSimulate;
        const seedValue = (hourProgress + dayProgress + loadConfig.nodeId.charCodeAt(0) / 255) % 1;
        
        if (seedValue < probabilityActive) {
          loadConsumption += loadConfig.powerDraw;
        }
      });
      
      // Calculate alternator generation
      let alternatorGeneration = 0;
      const engineStartHour = 8;
      const engineEndHour = engineStartHour + config.engineHoursPerDay;
      
      if (hour >= engineStartHour && hour < engineEndHour && hour < 24) {
        alternatorGeneration = dcDcCapacity > 0 ? dcDcCapacity * systemVoltage : alternatorCapacity;
      }
      
      // Calculate net power and update SOC
      const netPower = solarGeneration + alternatorGeneration - loadConsumption;
      const netCurrent = netPower / systemVoltage;
      const deltaSOC = totalBatteryCapacity > 0 ? (netCurrent / totalBatteryCapacity) * 100 : 0;
      
      currentSOC = Math.max(0, Math.min(100, currentSOC + deltaSOC));
      
      // Track stats
      totalSolarGenerated += solarGeneration;
      totalConsumed += loadConsumption;
      totalAlternatorGenerated += alternatorGeneration;
      
      minSOC = Math.min(minSOC, currentSOC);
      maxSOC = Math.max(maxSOC, currentSOC);
      totalSOC += currentSOC;
      dataPoints++;
      
      if (currentSOC < 20) dayHitBelow20 = true;
      
      // Store result every few hours for graphing
      if (hour % 3 === 0) {
        results.push({
          day,
          hour,
          batterySOC: currentSOC,
          solarGeneration,
          loadConsumption,
          alternatorGeneration,
          netPower,
        });
      }
    }
    
    if (dayHitBelow20) daysBelow20++;
  }
  
  const avgSOC = dataPoints > 0 ? totalSOC / dataPoints : 80;
  const sustainable = minSOC >= 20 && avgSOC >= 50;
  
  return {
    results,
    finalSOC: currentSOC,
    monthResult: {
      month: monthKey,
      monthName: monthData.name,
      minSOC,
      maxSOC,
      avgSOC,
      totalSolarGenerated,
      totalConsumed,
      daysBelow20,
      sustainable,
    },
  };
}

// Run scenario simulation
function runScenarioSimulation(
  nodes: Node<ComponentNodeData>[],
  edges: Edge[],
  config: ScenarioConfig
): ScenarioSummary {
  // Calculate total battery capacity
  let totalBatteryCapacity = 0;
  nodes.forEach((node) => {
    const spec = node.data.spec;
    if (spec?.type === 'battery' || spec?.type === 'battery-bank') {
      totalBatteryCapacity += (node.data.customValues?.capacity as number) || spec.capacity || 100;
    }
  });
  
  // Calculate solar panel capacity
  let totalSolarCapacity = 0;
  nodes.forEach((node) => {
    const spec = node.data.spec;
    if (spec?.type === 'solar-panel') {
      totalSolarCapacity += (node.data.customValues?.wattage as number) || spec.wattage || 100;
    } else if (spec?.type === 'solar-array') {
      const wattagePerPanel = (node.data.customValues?.wattage as number) || spec.wattage || 100;
      const panelCount = (node.data.customValues?.panelCount as number) || spec.panelCount || 2;
      totalSolarCapacity += wattagePerPanel * panelCount;
    }
  });
  
  // Calculate alternator capacity
  let alternatorCapacity = 0;
  nodes.forEach((node) => {
    const spec = node.data.spec;
    if (spec?.type === 'alternator') {
      alternatorCapacity += spec.maxOutput || 50;
    }
  });
  
  // Calculate DC-DC charger capacity
  let dcDcCapacity = 0;
  nodes.forEach((node) => {
    const spec = node.data.spec;
    if (spec?.type === 'dc-dc-charger' || spec?.type === 'dc-dc-mppt-charger') {
      dcDcCapacity += (node.data.customValues?.chargeRate as number) || spec.chargeRate || 30;
    }
  });
  
  // If simulating all months, run for each month
  if (config.simulateAllMonths) {
    const monthlyResults: MonthlyResult[] = [];
    let allResults: ScenarioResult[] = [];
    let currentSOC = 80;
    
    // Simulate 7 days of each month
    const daysPerMonth = 7;
    
    for (let m = 1; m <= 12; m++) {
      const monthKey = String(m);
      const monthConfig = { ...config, daysToSimulate: daysPerMonth };
      
      const { results, monthResult, finalSOC } = runMonthSimulation(
        nodes, monthConfig, monthKey,
        totalBatteryCapacity, totalSolarCapacity, dcDcCapacity, alternatorCapacity,
        currentSOC
      );
      
      monthlyResults.push(monthResult);
      allResults = allResults.concat(results.map(r => ({ ...r, day: r.day + (m - 1) * daysPerMonth })));
      currentSOC = finalSOC;
    }
    
    // Calculate overall stats
    const minSOC = Math.min(...monthlyResults.map(m => m.minSOC));
    const maxSOC = Math.max(...monthlyResults.map(m => m.maxSOC));
    const avgSOC = monthlyResults.reduce((sum, m) => sum + m.avgSOC, 0) / 12;
    const totalSolarGenerated = monthlyResults.reduce((sum, m) => sum + m.totalSolarGenerated, 0);
    const totalConsumed = monthlyResults.reduce((sum, m) => sum + m.totalConsumed, 0);
    const daysBelow20 = monthlyResults.reduce((sum, m) => sum + m.daysBelow20, 0);
    const sustainableMonths = monthlyResults.filter(m => m.sustainable).length;
    
    // Find worst and best months
    const worstMonth = monthlyResults.reduce((worst, m) => m.minSOC < worst.minSOC ? m : worst);
    const bestMonth = monthlyResults.reduce((best, m) => m.avgSOC > best.avgSOC ? m : best);
    
    // Generate yearly recommendations
    const recommendations: string[] = [];
    
    if (sustainableMonths === 12) {
      recommendations.push('✅ Your system is sustainable year-round!');
    } else if (sustainableMonths >= 9) {
      recommendations.push(`⚠️ System struggles in ${12 - sustainableMonths} month(s): ${monthlyResults.filter(m => !m.sustainable).map(m => m.monthName).join(', ')}`);
    } else if (sustainableMonths >= 6) {
      recommendations.push(`❌ System only sustainable for ${sustainableMonths} months.`);
    } else {
      recommendations.push('❌ System is not sustainable for most of the year.');
    }
    
    recommendations.push(`📅 Worst month: ${worstMonth.monthName} (min ${worstMonth.minSOC.toFixed(0)}% SOC)`);
    recommendations.push(`📅 Best month: ${bestMonth.monthName} (avg ${bestMonth.avgSOC.toFixed(0)}% SOC)`);
    
    // Calculate what's needed for year-round sustainability
    if (sustainableMonths < 12) {
      const worstMonthData = MONTHLY_SOLAR_DATA[worstMonth.month];
      const locationMult = LOCATION_MULTIPLIERS[config.location]?.solar || 1.0;
      const avgDailyDeficit = (worstMonth.totalConsumed - worstMonth.totalSolarGenerated) / 7;
      
      if (avgDailyDeficit > 0) {
        const additionalSolarNeeded = Math.ceil(avgDailyDeficit / (worstMonthData.avgSunHours * locationMult * 0.85));
        recommendations.push(`☀️ Add ~${additionalSolarNeeded}W solar for ${worstMonth.monthName} sustainability`);
      }
      
      const additionalBatteryNeeded = Math.ceil((avgDailyDeficit / 12.6) * 2); // 2 days reserve
      if (additionalBatteryNeeded > 50) {
        recommendations.push(`🔋 Consider adding ~${additionalBatteryNeeded}Ah battery capacity`);
      }
    }
    
    return {
      results: allResults,
      monthlyResults,
      minSOC,
      maxSOC,
      avgSOC,
      totalSolarGenerated,
      totalConsumed,
      totalAlternatorGenerated: 0,
      daysBelow20,
      sustainable: sustainableMonths === 12,
      recommendation: recommendations.join('\n'),
      worstMonth: worstMonth.monthName,
      bestMonth: bestMonth.monthName,
    };
  }
  
  // Single month simulation
  const { results, monthResult } = runMonthSimulation(
    nodes, config, config.month,
    totalBatteryCapacity, totalSolarCapacity, dcDcCapacity, alternatorCapacity
  );
  
  // Generate recommendations for single month
  const monthData = MONTHLY_SOLAR_DATA[config.month];
  const recommendations: string[] = [];
  
  if (monthResult.sustainable) {
    recommendations.push(`✅ System is sustainable for ${monthData.name}!`);
    if (monthResult.minSOC > 60) {
      recommendations.push('💡 Excess capacity available.');
    }
  } else {
    if (monthResult.minSOC < 20) {
      recommendations.push(`⚠️ Battery drops below 20% on ${monthResult.daysBelow20} day(s).`);
    }
    
    const avgDailyDeficit = (monthResult.totalConsumed - monthResult.totalSolarGenerated) / config.daysToSimulate;
    if (avgDailyDeficit > 0) {
      const locationMult = LOCATION_MULTIPLIERS[config.location]?.solar || 1.0;
      const additionalSolarNeeded = Math.ceil(avgDailyDeficit / (monthData.avgSunHours * locationMult * 0.85));
      recommendations.push(`☀️ Consider adding ~${additionalSolarNeeded}W more solar.`);
    }
    
    if (config.engineHoursPerDay < 1) {
      recommendations.push('⚙️ Consider running engine 1-2 hours/day.');
    }
  }
  
  return {
    results,
    minSOC: monthResult.minSOC,
    maxSOC: monthResult.maxSOC,
    avgSOC: monthResult.avgSOC,
    totalSolarGenerated: monthResult.totalSolarGenerated,
    totalConsumed: monthResult.totalConsumed,
    totalAlternatorGenerated: 0,
    daysBelow20: monthResult.daysBelow20,
    sustainable: monthResult.sustainable,
    recommendation: recommendations.join('\n'),
  };
}

interface SimulationPanelProps {
  nodes: Node<ComponentNodeData>[];
  edges: Edge[];
  isOpen: boolean;
  onToggle: () => void;
  onSimulationUpdate?: (simulation: SystemSimulation) => void;
}

export const SimulationPanel: React.FC<SimulationPanelProps> = ({
  nodes,
  edges,
  isOpen,
  onToggle,
  onSimulationUpdate,
}) => {
  const [isRunning, setIsRunning] = useState(false);
  const [simTime, setSimTime] = useState(0);
  const [simSpeed, setSimSpeed] = useState(1);
  const [simulation, setSimulation] = useState<SystemSimulation | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string>('6'); // Default to June
  const [environment, setEnvironment] = useState<EnvironmentState>({
    solarIrradiance: MONTHLY_SOLAR_DATA['6'].avgIrradiance, // June default
    ambientTemp: MONTHLY_SOLAR_DATA['6'].avgTemp,
    engineRunning: false,
    alternatorRPM: 0,
    shoreConnected: false,
  });
  
  // Resizable panel state
  const [panelHeight, setPanelHeight] = useState(40); // vh units
  const [isResizing, setIsResizing] = useState(false);
  
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const prevSimRef = useRef<SystemSimulation | undefined>(undefined);

  // Handle resize
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const windowHeight = window.innerHeight;
      const newHeight = ((windowHeight - e.clientY) / windowHeight) * 100;
      setPanelHeight(Math.min(Math.max(20, newHeight), 80)); // Clamp between 20vh and 80vh
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  // Run simulation step
  const runStep = () => {
    const deltaTime = simSpeed; // seconds per tick
    const result = runSimulation(nodes, edges, environment, prevSimRef.current, deltaTime);
    setSimulation(result);
    prevSimRef.current = result;
    setSimTime((t) => t + deltaTime);
    onSimulationUpdate?.(result);
  };

  // Handle play/pause
  useEffect(() => {
    if (isRunning) {
      intervalRef.current = setInterval(runStep, 1000);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isRunning, nodes, edges, environment, simSpeed]);

  // Initial simulation
  useEffect(() => {
    if (!simulation) {
      runStep();
    }
  }, [nodes, edges]);

  const handleReset = () => {
    setSimTime(0);
    prevSimRef.current = undefined;
    runStep();
  };

  const handleEngineToggle = () => {
    setEnvironment((prev) => ({
      ...prev,
      engineRunning: !prev.engineRunning,
      alternatorRPM: !prev.engineRunning ? 2500 : 0,
    }));
  };

  // Calculate charge summary
  const chargeSummary = useMemo(() => 
    calculateChargeSummary(nodes, simulation, environment),
    [nodes, simulation, environment]
  );

  // Scenario Simulation State
  const [showScenario, setShowScenario] = useState(false);
  const [scenarioConfig, setScenarioConfig] = useState<ScenarioConfig>({
    month: '6', // June default
    daysToSimulate: 7,
    engineHoursPerDay: 1,
    loadUsage: [],
    simulateAllMonths: false,
    location: 'uk',
  });
  const [scenarioResult, setScenarioResult] = useState<ScenarioSummary | null>(null);
  const [isRunningScenario, setIsRunningScenario] = useState(false);

  // Initialize load usage from nodes
  useEffect(() => {
    const loads = nodes
      .filter((n) => n.data.spec?.category === 'load')
      .map((n) => ({
        nodeId: n.id,
        label: n.data.label || 'Load',
        hoursPerDay: 2,
        daysPerWeek: 7,
        powerDraw: (n.data.customValues?.maxCurrent as number) 
          ? (n.data.customValues.maxCurrent as number) * 12.6 
          : (n.data.spec?.maxCurrent || 1) * 12.6,
        usagePeriods: ['morning', 'afternoon', 'evening'] as TimePeriod[],
      }));
    
    setScenarioConfig((prev) => ({
      ...prev,
      loadUsage: loads,
    }));
  }, [nodes]);

  const runScenario = useCallback(() => {
    setIsRunningScenario(true);
    // Use setTimeout to allow UI to update
    setTimeout(() => {
      const result = runScenarioSimulation(nodes, edges, scenarioConfig);
      setScenarioResult(result);
      setIsRunningScenario(false);
    }, 100);
  }, [nodes, edges, scenarioConfig]);

  const updateLoadUsage = (nodeId: string, hoursPerDay: number) => {
    setScenarioConfig((prev) => ({
      ...prev,
      loadUsage: prev.loadUsage.map((l) =>
        l.nodeId === nodeId ? { ...l, hoursPerDay } : l
      ),
    }));
  };

  if (!isOpen) {
    return (
      <button
        onClick={onToggle}
        className="fixed bottom-4 right-4 bg-purple-600 text-white px-4 py-2 rounded-lg shadow-lg hover:bg-purple-700 z-50 flex items-center gap-2"
      >
        <span>📊</span> Simulation
      </button>
    );
  }

  return (
    <div 
      className="fixed bottom-0 left-0 right-0 bg-gray-900 text-white shadow-2xl z-50 overflow-hidden flex flex-col"
      style={{ height: `${panelHeight}vh` }}
    >
      {/* Resize Handle */}
      <div
        onMouseDown={handleMouseDown}
        className={`absolute top-0 left-0 right-0 h-2 cursor-ns-resize flex items-center justify-center hover:bg-gray-600 transition-colors ${isResizing ? 'bg-blue-500' : 'bg-gray-700'}`}
      >
        <div className="w-12 h-1 bg-gray-400 rounded-full"></div>
      </div>
      
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700 mt-2">
        <div className="flex items-center gap-4">
          <h3 className="font-bold text-lg">📊 System Simulation</h3>
          <span className="text-sm text-gray-400">Time: {formatSimTime(simTime)}</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Simulation Controls */}
          <button
            onClick={handleReset}
            className="px-3 py-1 bg-gray-600 hover:bg-gray-500 rounded text-sm"
            title="Reset"
          >
            ⏮️ Reset
          </button>
          <button
            onClick={() => setIsRunning(!isRunning)}
            className={`px-3 py-1 rounded text-sm ${
              isRunning ? 'bg-red-600 hover:bg-red-500' : 'bg-green-600 hover:bg-green-500'
            }`}
          >
            {isRunning ? '⏸️ Pause' : '▶️ Run'}
          </button>
          <select
            value={simSpeed}
            onChange={(e) => setSimSpeed(Number(e.target.value))}
            className="bg-gray-700 text-white px-2 py-1 rounded text-sm"
          >
            <option value={1}>1x Speed</option>
            <option value={10}>10x Speed</option>
            <option value={60}>1 min/s</option>
            <option value={600}>10 min/s</option>
            <option value={3600}>1 hr/s</option>
          </select>
          <button
            onClick={onToggle}
            className="px-2 py-1 bg-gray-600 hover:bg-gray-500 rounded"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {/* Charge Summary - Dynamic Overview */}
        {simulation && chargeSummary.batteryCount > 0 && (
          <div className="mb-4 bg-gradient-to-r from-blue-900/50 to-purple-900/50 rounded-lg p-4 border border-blue-700/50">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-bold text-lg text-blue-300">⚡ Charge Summary</h4>
              <span className={`px-3 py-1 rounded-full text-sm font-semibold ${
                chargeSummary.netChargeCurrent > 0.5 ? 'bg-green-600 text-white' :
                chargeSummary.netChargeCurrent < -0.5 ? 'bg-orange-600 text-white' :
                'bg-gray-600 text-gray-200'
              }`}>
                {chargeSummary.netChargeCurrent > 0.5 ? '🔌 CHARGING' :
                 chargeSummary.netChargeCurrent < -0.5 ? '🔋 DISCHARGING' : '⏸️ IDLE'}
              </span>
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {/* Battery Status */}
              <div className="bg-gray-800/50 rounded-lg p-3">
                <div className="text-xs text-gray-400 mb-1">Battery Status</div>
                <div className="flex items-baseline gap-1">
                  <span className={`text-2xl font-bold ${
                    chargeSummary.currentSoC > 50 ? 'text-green-400' :
                    chargeSummary.currentSoC > 20 ? 'text-yellow-400' : 'text-red-400'
                  }`}>
                    {chargeSummary.currentSoC.toFixed(0)}%
                  </span>
                  <span className="text-xs text-gray-500">of {chargeSummary.totalBatteryCapacity}Ah</span>
                </div>
                <div className="mt-2 h-2 bg-gray-700 rounded-full overflow-hidden">
                  <div 
                    className={`h-full transition-all duration-1000 ${
                      chargeSummary.currentSoC > 50 ? 'bg-green-500' :
                      chargeSummary.currentSoC > 20 ? 'bg-yellow-500' : 'bg-red-500'
                    }`}
                    style={{ width: `${chargeSummary.currentSoC}%` }}
                  />
                </div>
              </div>
              
              {/* Time to Full */}
              <div className="bg-gray-800/50 rounded-lg p-3">
                <div className="text-xs text-gray-400 mb-1">
                  {chargeSummary.netChargeCurrent > 0 ? '⏱️ Time to Full' : '⏱️ Est. Full Charge'}
                </div>
                <div className="text-2xl font-bold text-green-400">
                  {formatDuration(chargeSummary.timeToFull)}
                </div>
                {chargeSummary.netChargeCurrent > 0 && (
                  <div className="text-xs text-gray-500 mt-1">
                    +{chargeSummary.netChargeCurrent.toFixed(1)}A net
                  </div>
                )}
              </div>
              
              {/* Runtime / Time to Empty */}
              <div className="bg-gray-800/50 rounded-lg p-3">
                <div className="text-xs text-gray-400 mb-1">
                  {chargeSummary.netChargeCurrent < 0 ? '⏱️ Time Remaining' : '🔋 Runtime (no charge)'}
                </div>
                <div className={`text-2xl font-bold ${
                  chargeSummary.netChargeCurrent < 0 ? 'text-orange-400' : 'text-gray-400'
                }`}>
                  {formatDuration(chargeSummary.netChargeCurrent < 0 ? chargeSummary.timeToEmpty : chargeSummary.runtime)}
                </div>
                {chargeSummary.averageLoadCurrent > 0 && (
                  <div className="text-xs text-gray-500 mt-1">
                    -{chargeSummary.averageLoadCurrent.toFixed(1)}A load
                  </div>
                )}
              </div>
              
              {/* Power Balance */}
              <div className="bg-gray-800/50 rounded-lg p-3">
                <div className="text-xs text-gray-400 mb-1">⚖️ Power Balance</div>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-green-400">↓ In:</span>
                    <span className="font-mono text-green-400">{simulation.totalGeneration.toFixed(0)}W</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-orange-400">↑ Out:</span>
                    <span className="font-mono text-orange-400">{simulation.totalLoad.toFixed(0)}W</span>
                  </div>
                  <div className="flex justify-between text-xs border-t border-gray-700 pt-1">
                    <span className={simulation.netPower >= 0 ? 'text-green-400' : 'text-red-400'}>Net:</span>
                    <span className={`font-mono font-bold ${simulation.netPower >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {simulation.netPower >= 0 ? '+' : ''}{simulation.netPower.toFixed(0)}W
                    </span>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Additional Info Row */}
            <div className="mt-3 pt-3 border-t border-gray-700/50 grid grid-cols-3 gap-4 text-xs">
              <div className="flex justify-between">
                <span className="text-gray-400">☀️ Est. Daily Solar:</span>
                <span className="text-yellow-400 font-mono">{chargeSummary.dailySolarYield.toFixed(0)}Wh</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">🔋 Usable Capacity:</span>
                <span className="text-blue-400 font-mono">{(chargeSummary.totalBatteryCapacity * 0.8).toFixed(0)}Ah</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">⚡ System Voltage:</span>
                <span className={`font-mono ${simulation.systemVoltage < 11.5 ? 'text-red-400' : simulation.systemVoltage > 14.4 ? 'text-yellow-400' : 'text-green-400'}`}>
                  {simulation.systemVoltage.toFixed(2)}V
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Scenario Simulator Toggle */}
        <div className="mb-4">
          <button
            onClick={() => setShowScenario(!showScenario)}
            className={`w-full px-4 py-3 rounded-lg font-semibold flex items-center justify-between transition-all ${
              showScenario 
                ? 'bg-gradient-to-r from-indigo-700 to-purple-700 text-white' 
                : 'bg-gray-800 hover:bg-gray-700 text-gray-200'
            }`}
          >
            <div className="flex items-center gap-2">
              <span>📅</span>
              <span>Scenario Simulator</span>
              <span className="text-xs text-gray-400 ml-2">
                (Plan your usage over days/weeks)
              </span>
            </div>
            <span className="text-lg">{showScenario ? '▼' : '▶'}</span>
          </button>
          
          {/* Scenario Configuration Panel */}
          {showScenario && (
            <div className="mt-2 bg-gradient-to-r from-indigo-900/50 to-purple-900/50 rounded-lg p-4 border border-indigo-700/50">
              {/* Top row - Location and Simulation Type */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                {/* Location */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1">📍 Location</label>
                  <select
                    value={scenarioConfig.location}
                    onChange={(e) => setScenarioConfig((prev) => ({ ...prev, location: e.target.value as 'uk' | 'mediterranean' | 'northern' | 'tropical' }))}
                    className="w-full bg-gray-700 text-white px-3 py-2 rounded text-sm"
                  >
                    <option value="uk">🇬🇧 UK / Northern Europe</option>
                    <option value="mediterranean">🌊 Mediterranean</option>
                    <option value="northern">❄️ Scandinavia / Scotland</option>
                    <option value="tropical">🌴 Tropical / Caribbean</option>
                  </select>
                </div>
                
                {/* Yearly toggle */}
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={scenarioConfig.simulateAllMonths}
                      onChange={(e) => setScenarioConfig((prev) => ({ ...prev, simulateAllMonths: e.target.checked }))}
                      className="w-4 h-4 rounded bg-gray-700 border-gray-600"
                    />
                    <span className="text-sm text-gray-300">📊 Simulate full year (all 12 months)</span>
                  </label>
                </div>
              </div>
              
              {/* Second row - Month/Days/Engine */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                {/* Month Selector - only show if not simulating all months */}
                {!scenarioConfig.simulateAllMonths && (
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">📅 Month</label>
                    <select
                      value={scenarioConfig.month}
                      onChange={(e) => setScenarioConfig((prev) => ({ ...prev, month: e.target.value }))}
                      className="w-full bg-gray-700 text-white px-3 py-2 rounded text-sm"
                    >
                      {Object.entries(MONTHLY_SOLAR_DATA).map(([key, data]) => (
                        <option key={key} value={key}>
                          {data.name} ({data.avgSunHours}h sun)
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                
                {/* Days to Simulate - only show if not simulating all months */}
                {!scenarioConfig.simulateAllMonths && (
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">📆 Days to Simulate</label>
                    <select
                      value={scenarioConfig.daysToSimulate}
                      onChange={(e) => setScenarioConfig((prev) => ({ ...prev, daysToSimulate: Number(e.target.value) }))}
                      className="w-full bg-gray-700 text-white px-3 py-2 rounded text-sm"
                    >
                      <option value={3}>3 days</option>
                      <option value={7}>1 week</option>
                      <option value={14}>2 weeks</option>
                      <option value={30}>1 month</option>
                    </select>
                  </div>
                )}
                
                {/* Engine Hours */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1">⚙️ Engine Hours/Day</label>
                  <select
                    value={scenarioConfig.engineHoursPerDay}
                    onChange={(e) => setScenarioConfig((prev) => ({ ...prev, engineHoursPerDay: Number(e.target.value) }))}
                    className="w-full bg-gray-700 text-white px-3 py-2 rounded text-sm"
                  >
                    <option value={0}>0 (No engine)</option>
                    <option value={0.5}>30 min</option>
                    <option value={1}>1 hour</option>
                    <option value={2}>2 hours</option>
                    <option value={3}>3 hours</option>
                    <option value={4}>4 hours</option>
                  </select>
                </div>
                
                {/* Run Button */}
                <div className="flex items-end">
                  <button
                    onClick={runScenario}
                    disabled={isRunningScenario}
                    className="w-full px-4 py-2 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 disabled:from-gray-600 disabled:to-gray-600 text-white rounded font-semibold transition-all"
                  >
                    {isRunningScenario ? '⏳ Running...' : scenarioConfig.simulateAllMonths ? '🚀 Run Year' : '🚀 Run Scenario'}
                  </button>
                </div>
              </div>
              
              {/* Load Usage Configuration - Enhanced */}
              {scenarioConfig.loadUsage.length > 0 && (
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-3">
                    <h5 className="text-sm font-semibold text-indigo-300">⚡ Configure Your Device Usage</h5>
                    <div className="text-xs text-gray-400">
                      Total: <span className="text-yellow-400 font-mono">
                        {(scenarioConfig.loadUsage.reduce((sum, l) => sum + (l.powerDraw * l.hoursPerDay * l.daysPerWeek), 0) / 1000).toFixed(1)} kWh/week
                      </span>
                    </div>
                  </div>
                  
                  {/* Quick summary of configured devices */}
                  <div className="bg-gray-800/30 rounded-lg p-3 mb-3 text-xs">
                    <div className="text-gray-400 mb-2">📋 Your usage summary:</div>
                    <div className="space-y-1">
                      {scenarioConfig.loadUsage.filter(l => l.hoursPerDay > 0).map((load) => (
                        <div key={load.nodeId} className="flex items-center gap-2 text-gray-300">
                          <span className="text-indigo-400">•</span>
                          <span className="font-medium">{load.label}</span>
                          <span className="text-gray-500">—</span>
                          <span className="text-cyan-400">{load.hoursPerDay}h/day</span>
                          <span className="text-gray-500">×</span>
                          <span className="text-purple-400">{load.daysPerWeek} days/week</span>
                          <span className="text-gray-500">=</span>
                          <span className="text-yellow-400 font-mono">{((load.powerDraw * load.hoursPerDay * load.daysPerWeek) / 1000).toFixed(2)} kWh</span>
                        </div>
                      ))}
                      {scenarioConfig.loadUsage.filter(l => l.hoursPerDay === 0).length > 0 && (
                        <div className="text-gray-500 italic mt-1">
                          + {scenarioConfig.loadUsage.filter(l => l.hoursPerDay === 0).length} device(s) turned off
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {scenarioConfig.loadUsage.map((load) => (
                      <div 
                        key={load.nodeId} 
                        className={`rounded-lg p-3 border transition-all ${
                          load.hoursPerDay > 0 
                            ? 'bg-gray-800/70 border-indigo-600/50 shadow-lg shadow-indigo-500/10' 
                            : 'bg-gray-800/30 border-gray-700/30 opacity-60'
                        }`}
                      >
                        {/* Device header */}
                        <div className="flex justify-between items-start mb-3">
                          <div>
                            <div className="font-semibold text-sm text-white">{load.label}</div>
                            <div className="text-xs text-gray-400">Power: {load.powerDraw.toFixed(0)}W</div>
                          </div>
                          <button
                            onClick={() => setScenarioConfig(prev => ({
                              ...prev,
                              loadUsage: prev.loadUsage.map(l => 
                                l.nodeId === load.nodeId ? { ...l, hoursPerDay: l.hoursPerDay > 0 ? 0 : 4 } : l
                              )
                            }))}
                            className={`px-2 py-1 text-xs rounded font-medium transition-colors ${
                              load.hoursPerDay > 0 
                                ? 'bg-green-600/80 text-white hover:bg-green-500' 
                                : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                            }`}
                          >
                            {load.hoursPerDay > 0 ? 'ON' : 'OFF'}
                          </button>
                        </div>
                        
                        {load.hoursPerDay > 0 && (
                          <>
                            {/* Hours per day - with number input */}
                            <div className="mb-3">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-xs text-gray-400">⏱️ Hours per day</span>
                                <div className="flex items-center gap-1">
                                  <input
                                    type="number"
                                    min="0.5"
                                    max="24"
                                    step="0.5"
                                    value={load.hoursPerDay}
                                    onChange={(e) => setScenarioConfig(prev => ({
                                      ...prev,
                                      loadUsage: prev.loadUsage.map(l => 
                                        l.nodeId === load.nodeId ? { ...l, hoursPerDay: Math.max(0, Math.min(24, Number(e.target.value))) } : l
                                      )
                                    }))}
                                    className="w-14 bg-gray-700 text-white px-2 py-1 rounded text-xs text-center font-mono"
                                  />
                                  <span className="text-xs text-gray-500">hrs</span>
                                </div>
                              </div>
                              <input
                                type="range"
                                min="0"
                                max="24"
                                step="0.5"
                                value={load.hoursPerDay}
                                onChange={(e) => setScenarioConfig(prev => ({
                                  ...prev,
                                  loadUsage: prev.loadUsage.map(l => 
                                    l.nodeId === load.nodeId ? { ...l, hoursPerDay: Number(e.target.value) } : l
                                  )
                                }))}
                                className="w-full h-1.5 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                              />
                              <div className="flex justify-between text-[10px] text-gray-500 mt-0.5">
                                <span>0</span>
                                <span>6</span>
                                <span>12</span>
                                <span>18</span>
                                <span>24</span>
                              </div>
                            </div>
                            
                            {/* Days per week - with quick buttons */}
                            <div className="mb-3">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-xs text-gray-400">📅 Days per week</span>
                                <span className="text-xs font-mono text-purple-400">{load.daysPerWeek} days</span>
                              </div>
                              <div className="flex gap-1">
                                {[1, 2, 3, 4, 5, 6, 7].map((day) => (
                                  <button
                                    key={day}
                                    onClick={() => setScenarioConfig(prev => ({
                                      ...prev,
                                      loadUsage: prev.loadUsage.map(l => 
                                        l.nodeId === load.nodeId ? { ...l, daysPerWeek: day } : l
                                      )
                                    }))}
                                    className={`flex-1 py-1 text-xs rounded font-mono transition-colors ${
                                      load.daysPerWeek >= day
                                        ? 'bg-purple-600 text-white'
                                        : 'bg-gray-700 text-gray-500 hover:bg-gray-600'
                                    }`}
                                  >
                                    {day}
                                  </button>
                                ))}
                              </div>
                              <div className="flex justify-between text-[10px] text-gray-500 mt-1">
                                <span>Occasional</span>
                                <span>Weekdays</span>
                                <span>Every day</span>
                              </div>
                            </div>
                            
                            {/* Usage time periods */}
                            <div className="mb-2">
                              <span className="text-xs text-gray-400 block mb-1">🕐 When do you use it?</span>
                              <div className="grid grid-cols-4 gap-1">
                                {(['morning', 'afternoon', 'evening', 'night'] as TimePeriod[]).map((period) => (
                                  <button
                                    key={period}
                                    onClick={() => setScenarioConfig(prev => ({
                                      ...prev,
                                      loadUsage: prev.loadUsage.map(l => {
                                        if (l.nodeId !== load.nodeId) return l;
                                        const periods = l.usagePeriods.includes(period)
                                          ? l.usagePeriods.filter(p => p !== period)
                                          : [...l.usagePeriods, period];
                                        return { ...l, usagePeriods: periods.length > 0 ? periods : [period] };
                                      })
                                    }))}
                                    className={`py-1.5 text-xs rounded flex flex-col items-center transition-colors ${
                                      load.usagePeriods.includes(period)
                                        ? 'bg-indigo-600 text-white'
                                        : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                                    }`}
                                    title={TIME_PERIODS[period].label}
                                  >
                                    <span className="text-sm">
                                      {period === 'morning' && '🌅'}
                                      {period === 'afternoon' && '☀️'}
                                      {period === 'evening' && '🌆'}
                                      {period === 'night' && '🌙'}
                                    </span>
                                    <span className="text-[10px] mt-0.5">
                                      {period === 'morning' && '6-12'}
                                      {period === 'afternoon' && '12-18'}
                                      {period === 'evening' && '18-23'}
                                      {period === 'night' && '23-6'}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          </>
                        )}
                        
                        {/* Weekly consumption estimate */}
                        <div className={`text-xs pt-2 border-t border-gray-700/50 flex justify-between ${
                          load.hoursPerDay > 0 ? 'text-gray-400' : 'text-gray-600'
                        }`}>
                          <span>Weekly use:</span>
                          <span className={load.hoursPerDay > 0 ? 'text-yellow-400 font-mono font-medium' : 'text-gray-600'}>
                            {((load.powerDraw * load.hoursPerDay * load.daysPerWeek) / 1000).toFixed(2)} kWh
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                  
                  {/* Daily energy breakdown */}
                  <div className="mt-4 p-3 bg-gray-800/50 rounded-lg">
                    <h6 className="text-xs font-semibold text-gray-400 mb-2">📊 Average Daily Energy Budget</h6>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                      <div>
                        <span className="text-gray-500">Daily consumption:</span>
                        <div className="text-orange-400 font-mono font-semibold">
                          {(scenarioConfig.loadUsage.reduce((sum, l) => sum + (l.powerDraw * l.hoursPerDay * l.daysPerWeek / 7), 0) / 1000).toFixed(2)} kWh
                        </div>
                      </div>
                      <div>
                        <span className="text-gray-500">Daily Ah (12V):</span>
                        <div className="text-blue-400 font-mono font-semibold">
                          {(scenarioConfig.loadUsage.reduce((sum, l) => sum + (l.powerDraw * l.hoursPerDay * l.daysPerWeek / 7), 0) / 12.6).toFixed(0)} Ah
                        </div>
                      </div>
                      <div>
                        <span className="text-gray-500">Weekly total:</span>
                        <div className="text-yellow-400 font-mono font-semibold">
                          {(scenarioConfig.loadUsage.reduce((sum, l) => sum + (l.powerDraw * l.hoursPerDay * l.daysPerWeek), 0) / 1000).toFixed(1)} kWh
                        </div>
                      </div>
                      <div>
                        <span className="text-gray-500">Active devices:</span>
                        <div className="text-green-400 font-mono font-semibold">
                          {scenarioConfig.loadUsage.filter(l => l.hoursPerDay > 0).length} / {scenarioConfig.loadUsage.length}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              
              {/* Scenario Results */}
              {scenarioResult && (
                <div className="border-t border-indigo-700/50 pt-4">
                  <h5 className="text-sm font-semibold text-indigo-300 mb-3">📊 Simulation Results</h5>
                  
                  {/* Recommendation Banner */}
                  <div className={`p-3 rounded-lg mb-4 ${
                    scenarioResult.sustainable 
                      ? 'bg-green-900/40 border border-green-700/50' 
                      : 'bg-orange-900/40 border border-orange-700/50'
                  }`}>
                    <div className="text-sm space-y-1">
                      {scenarioResult.recommendation.split('\n').map((line, i) => (
                        <p key={i}>{line}</p>
                      ))}
                    </div>
                  </div>
                  
                  {/* Monthly Breakdown for Yearly Simulation */}
                  {scenarioResult.monthlyResults && scenarioResult.monthlyResults.length > 0 && (
                    <div className="mb-4">
                      <h6 className="text-xs font-semibold text-gray-400 mb-2">📅 Monthly Breakdown</h6>
                      <div className="grid grid-cols-12 gap-1">
                        {scenarioResult.monthlyResults.map((month) => (
                          <div 
                            key={month.month}
                            className={`p-1 rounded text-center text-xs ${
                              month.sustainable 
                                ? 'bg-green-900/50 border border-green-700/30'
                                : 'bg-red-900/50 border border-red-700/30'
                            }`}
                            title={`${month.monthName}: Min ${month.minSOC.toFixed(0)}%, Avg ${month.avgSOC.toFixed(0)}%`}
                          >
                            <div className="font-semibold">{MONTHLY_SOLAR_DATA[month.month].shortName}</div>
                            <div className={`text-lg font-bold ${
                              month.minSOC > 50 ? 'text-green-400' :
                              month.minSOC > 20 ? 'text-yellow-400' : 'text-red-400'
                            }`}>
                              {month.minSOC.toFixed(0)}%
                            </div>
                            <div className="text-gray-500 text-[10px]">
                              {month.sustainable ? '✓' : '✗'}
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="flex justify-between text-xs text-gray-500 mt-1">
                        <span>Worst: {scenarioResult.worstMonth}</span>
                        <span>Best: {scenarioResult.bestMonth}</span>
                      </div>
                    </div>
                  )}
                  
                  {/* Stats Grid */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                    <div className="bg-gray-800/50 rounded p-2 text-center">
                      <div className="text-xs text-gray-400">Min Battery</div>
                      <div className={`text-xl font-bold ${
                        scenarioResult.minSOC > 50 ? 'text-green-400' :
                        scenarioResult.minSOC > 20 ? 'text-yellow-400' : 'text-red-400'
                      }`}>
                        {scenarioResult.minSOC.toFixed(0)}%
                      </div>
                    </div>
                    <div className="bg-gray-800/50 rounded p-2 text-center">
                      <div className="text-xs text-gray-400">Avg Battery</div>
                      <div className={`text-xl font-bold ${
                        scenarioResult.avgSOC > 50 ? 'text-green-400' :
                        scenarioResult.avgSOC > 30 ? 'text-yellow-400' : 'text-orange-400'
                      }`}>
                        {scenarioResult.avgSOC.toFixed(0)}%
                      </div>
                    </div>
                    <div className="bg-gray-800/50 rounded p-2 text-center">
                      <div className="text-xs text-gray-400">Max Battery</div>
                      <div className="text-xl font-bold text-green-400">
                        {scenarioResult.maxSOC.toFixed(0)}%
                      </div>
                    </div>
                    <div className="bg-gray-800/50 rounded p-2 text-center">
                      <div className="text-xs text-gray-400">Days Below 20%</div>
                      <div className={`text-xl font-bold ${
                        scenarioResult.daysBelow20 === 0 ? 'text-green-400' : 'text-red-400'
                      }`}>
                        {scenarioResult.daysBelow20}
                      </div>
                    </div>
                  </div>
                  
                  {/* Energy Summary */}
                  <div className="grid grid-cols-3 gap-3 mb-4 text-xs">
                    <div className="bg-gray-800/50 rounded p-2">
                      <div className="text-gray-400 mb-1">☀️ Solar Generated</div>
                      <div className="text-yellow-400 font-mono text-lg">
                        {(scenarioResult.totalSolarGenerated / 1000).toFixed(1)} kWh
                      </div>
                      <div className="text-gray-500">
                        ({(scenarioResult.totalSolarGenerated / scenarioConfig.daysToSimulate / 1000).toFixed(2)} kWh/day)
                      </div>
                    </div>
                    <div className="bg-gray-800/50 rounded p-2">
                      <div className="text-gray-400 mb-1">⚙️ Alternator Generated</div>
                      <div className="text-blue-400 font-mono text-lg">
                        {(scenarioResult.totalAlternatorGenerated / 1000).toFixed(1)} kWh
                      </div>
                      <div className="text-gray-500">
                        ({(scenarioResult.totalAlternatorGenerated / scenarioConfig.daysToSimulate / 1000).toFixed(2)} kWh/day)
                      </div>
                    </div>
                    <div className="bg-gray-800/50 rounded p-2">
                      <div className="text-gray-400 mb-1">🔌 Total Consumed</div>
                      <div className="text-orange-400 font-mono text-lg">
                        {(scenarioResult.totalConsumed / 1000).toFixed(1)} kWh
                      </div>
                      <div className="text-gray-500">
                        ({(scenarioResult.totalConsumed / scenarioConfig.daysToSimulate / 1000).toFixed(2)} kWh/day)
                      </div>
                    </div>
                  </div>
                  
                  {/* Battery Graph (Simple ASCII-style) */}
                  <div className="bg-gray-800/50 rounded p-3">
                    <div className="text-xs text-gray-400 mb-2">Battery SOC Over Time</div>
                    <div className="h-20 flex items-end gap-px">
                      {scenarioResult.results.slice(0, 84).map((r, i) => (
                        <div
                          key={i}
                          className={`flex-1 min-w-[2px] rounded-t transition-all ${
                            r.batterySOC > 50 ? 'bg-green-500' :
                            r.batterySOC > 20 ? 'bg-yellow-500' : 'bg-red-500'
                          }`}
                          style={{ height: `${r.batterySOC}%` }}
                          title={`Day ${r.day + 1}, ${r.hour}:00 - ${r.batterySOC.toFixed(0)}%`}
                        />
                      ))}
                    </div>
                    <div className="flex justify-between text-[10px] text-gray-500 mt-1">
                      <span>Day 1</span>
                      <span>Day {Math.ceil(scenarioConfig.daysToSimulate / 2)}</span>
                      <span>Day {scenarioConfig.daysToSimulate}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* System Overview */}
          <div className="bg-gray-800 rounded-lg p-4">
            <h4 className="font-semibold text-purple-400 mb-3">⚡ System Overview</h4>
            {simulation && (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">System Voltage:</span>
                  <span className={`font-mono ${simulation.systemVoltage < 11.5 ? 'text-red-400' : simulation.systemVoltage > 14 ? 'text-yellow-400' : 'text-green-400'}`}>
                    {simulation.systemVoltage.toFixed(2)}V
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Total Generation:</span>
                  <span className="font-mono text-green-400">{simulation.totalGeneration.toFixed(1)}W</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Total Load:</span>
                  <span className="font-mono text-orange-400">{simulation.totalLoad.toFixed(1)}W</span>
                </div>
                <div className="flex justify-between border-t border-gray-700 pt-2">
                  <span className="text-gray-400">Net Power:</span>
                  <span className={`font-mono font-bold ${simulation.netPower >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {simulation.netPower >= 0 ? '+' : ''}{simulation.netPower.toFixed(1)}W
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Environment Controls */}
          <div className="bg-gray-800 rounded-lg p-4">
            <h4 className="font-semibold text-yellow-400 mb-3">🌤️ Environment</h4>
            <div className="space-y-3 text-sm">
              {/* Month-based Solar Selection */}
              <div>
                <label className="text-gray-400 text-xs mb-2 block">☀️ Select Month (avg. sun levels for UK)</label>
                <div className="grid grid-cols-6 gap-1 mb-2">
                  {Object.entries(MONTHLY_SOLAR_DATA).map(([monthNum, data]) => (
                    <button
                      key={monthNum}
                      onClick={() => {
                        setSelectedMonth(monthNum);
                        setEnvironment((prev) => ({
                          ...prev,
                          solarIrradiance: data.avgIrradiance,
                          ambientTemp: data.avgTemp,
                        }));
                      }}
                      className={`px-1 py-1.5 rounded text-xs font-medium transition-colors ${
                        selectedMonth === monthNum
                          ? 'bg-yellow-500 text-gray-900'
                          : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                      }`}
                      title={`${data.name}: ${data.avgIrradiance} W/m², ${data.avgSunHours}h sun, ${data.avgTemp}°C`}
                    >
                      {data.shortName}
                    </button>
                  ))}
                </div>
                <div className="bg-gray-700 rounded p-2 text-xs">
                  <div className="flex justify-between mb-1">
                    <span className="text-gray-400">{MONTHLY_SOLAR_DATA[selectedMonth].name}</span>
                    <span className="text-yellow-400 font-semibold">{environment.solarIrradiance} W/m²</span>
                  </div>
                  <div className="flex justify-between text-gray-500">
                    <span>☀️ {MONTHLY_SOLAR_DATA[selectedMonth].avgSunHours}h avg sun/day</span>
                    <span>🌡️ {MONTHLY_SOLAR_DATA[selectedMonth].avgTemp}°C avg</span>
                  </div>
                </div>
              </div>
              
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Engine Running:</span>
                <button
                  onClick={handleEngineToggle}
                  className={`px-3 py-1 rounded text-sm font-semibold ${
                    environment.engineRunning 
                      ? 'bg-green-600 text-white' 
                      : 'bg-gray-600 text-gray-300'
                  }`}
                >
                  {environment.engineRunning ? '⚙️ ON' : '⚙️ OFF'}
                </button>
              </div>
              
              {environment.engineRunning && (
                <div>
                  <label className="text-gray-400 text-xs">Alternator RPM</label>
                  <input
                    type="range"
                    min="800"
                    max="5000"
                    value={environment.alternatorRPM}
                    onChange={(e) => setEnvironment((prev) => ({ ...prev, alternatorRPM: Number(e.target.value) }))}
                    className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                  />
                  <div className="text-center text-xs text-gray-400">{environment.alternatorRPM} RPM</div>
                </div>
              )}
            </div>
          </div>

          {/* Batteries & Chargers */}
          <div className="bg-gray-800 rounded-lg p-4">
            <h4 className="font-semibold text-green-400 mb-3">🔋 Batteries & Chargers</h4>
            {simulation && (
              <div className="space-y-2 text-sm max-h-32 overflow-y-auto">
                {nodes
                  .filter((n) => ['battery', 'battery-bank', 'dc-dc-mppt-charger', 'dc-dc-charger'].includes(n.data.spec?.type || ''))
                  .map((node) => {
                    const state = simulation.nodes[node.id];
                    if (!state) return null;
                    
                    const isBattery = node.data.spec?.type === 'battery' || node.data.spec?.type === 'battery-bank';
                    const isCharger = node.data.spec?.type?.includes('charger');
                    
                    return (
                      <div key={node.id} className="bg-gray-700 rounded p-2">
                        <div className="flex justify-between items-center">
                          <span className="font-medium truncate">{node.data.label}</span>
                          <span className={`text-xs px-1 rounded ${
                            state.state === 'charging' ? 'bg-green-600' :
                            state.state === 'discharging' ? 'bg-orange-600' :
                            state.state === 'on' ? 'bg-blue-600' : 'bg-gray-600'
                          }`}>
                            {state.state}
                          </span>
                        </div>
                        <div className="flex justify-between text-xs text-gray-400 mt-1">
                          {isBattery && state.stateOfCharge !== undefined && (
                            <>
                              <span>SoC: {state.stateOfCharge.toFixed(0)}%</span>
                              <span>{state.voltage.toFixed(2)}V</span>
                              <span>{state.current.toFixed(1)}A</span>
                            </>
                          )}
                          {isCharger && (
                            <>
                              <span>Out: {state.outputCurrent?.toFixed(1) || state.current.toFixed(1)}A</span>
                              <span>{state.power.toFixed(0)}W</span>
                              {state.solarInputPower !== undefined && state.solarInputPower > 0 && (
                                <span className="text-yellow-400">☀️{state.solarInputPower.toFixed(0)}W</span>
                              )}
                            </>
                          )}
                        </div>
                        {isBattery && state.stateOfCharge !== undefined && (
                          <div className="mt-1 h-2 bg-gray-600 rounded overflow-hidden">
                            <div
                              className={`h-full transition-all duration-500 ${
                                state.stateOfCharge > 50 ? 'bg-green-500' :
                                state.stateOfCharge > 20 ? 'bg-yellow-500' : 'bg-red-500'
                              }`}
                              style={{ width: `${state.stateOfCharge}%` }}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        </div>

        {/* Warnings and Errors */}
        {simulation && (simulation.warnings.length > 0 || simulation.errors.length > 0) && (
          <div className="mt-4 flex gap-4">
            {simulation.warnings.length > 0 && (
              <div className="flex-1 bg-yellow-900/30 border border-yellow-700 rounded-lg p-3">
                <h5 className="font-semibold text-yellow-400 text-sm mb-2">⚠️ Warnings</h5>
                <ul className="text-xs text-yellow-300 space-y-1">
                  {simulation.warnings.map((w, i) => (
                    <li key={i}>• {w}</li>
                  ))}
                </ul>
              </div>
            )}
            {simulation.errors.length > 0 && (
              <div className="flex-1 bg-red-900/30 border border-red-700 rounded-lg p-3">
                <h5 className="font-semibold text-red-400 text-sm mb-2">❌ Errors</h5>
                <ul className="text-xs text-red-300 space-y-1">
                  {simulation.errors.map((e, i) => (
                    <li key={i}>• {e}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Component Monitor */}
        <div className="mt-4 bg-gray-800 rounded-lg p-4">
          <h4 className="font-semibold text-blue-400 mb-3">📋 All Components</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-400 border-b border-gray-700">
                  <th className="pb-2">Component</th>
                  <th className="pb-2">Type</th>
                  <th className="pb-2">State</th>
                  <th className="pb-2">Voltage</th>
                  <th className="pb-2">Current</th>
                  <th className="pb-2">Power</th>
                </tr>
              </thead>
              <tbody>
                {simulation && nodes.map((node) => {
                  const state = simulation.nodes[node.id];
                  if (!state) return null;
                  
                  return (
                    <tr key={node.id} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                      <td className="py-1 font-medium">{node.data.label}</td>
                      <td className="py-1 text-gray-400">{node.data.spec?.type}</td>
                      <td className="py-1">
                        <span className={`px-1 rounded text-xs ${
                          state.state === 'on' || state.state === 'charging' ? 'bg-green-600' :
                          state.state === 'discharging' ? 'bg-orange-600' :
                          state.state === 'fault' ? 'bg-red-600' : 'bg-gray-600'
                        }`}>
                          {state.state}
                        </span>
                      </td>
                      <td className="py-1 font-mono">{state.voltage.toFixed(2)}V</td>
                      <td className="py-1 font-mono">{state.current.toFixed(2)}A</td>
                      <td className="py-1 font-mono">{state.power.toFixed(1)}W</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
