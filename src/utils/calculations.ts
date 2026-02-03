import { WIRE_GAUGES, STANDARD_FUSE_RATINGS, STANDARD_BREAKER_RATINGS, WireGaugeSpec } from '../types';

/**
 * Calculate voltage drop for a given wire
 * Formula: Voltage Drop = (2 × Length × Current × Resistance) / 1000
 * Where resistance is in ohms per 1000 feet
 */
export function calculateVoltageDrop(
  current: number,
  lengthFeet: number,
  awg: string,
  systemVoltage: number = 12
): { voltageDrop: number; percentDrop: number; isAcceptable: boolean } {
  const wireSpec = WIRE_GAUGES.find(w => w.awg === awg);
  if (!wireSpec) {
    return { voltageDrop: 0, percentDrop: 0, isAcceptable: false };
  }

  // Round-trip wire length (positive and negative)
  const totalLength = lengthFeet * 2;
  const voltageDrop = (totalLength * current * wireSpec.resistance) / 1000;
  const percentDrop = (voltageDrop / systemVoltage) * 100;
  
  // ABYC recommends max 3% for critical circuits, 10% for non-critical
  const isAcceptable = percentDrop <= 10;

  return { voltageDrop, percentDrop, isAcceptable };
}

/**
 * Recommend wire gauge based on current and length
 * Returns the smallest adequate wire gauge
 */
export function recommendWireGauge(
  current: number,
  lengthFeet: number,
  systemVoltage: number = 12,
  maxDropPercent: number = 3
): { recommended: string; alternative: string | null; allSuitable: WireGaugeSpec[] } {
  const suitableGauges: WireGaugeSpec[] = [];

  for (const wire of WIRE_GAUGES) {
    const { percentDrop } = calculateVoltageDrop(current, lengthFeet, wire.awg, systemVoltage);
    if (percentDrop <= maxDropPercent) {
      suitableGauges.push(wire);
    }
  }

  // Sort by AWG (smaller number = thicker wire, but we want thinnest adequate)
  suitableGauges.sort((a, b) => {
    const aNum = parseAWG(a.awg);
    const bNum = parseAWG(b.awg);
    return bNum - aNum; // Higher number first (thinner wire)
  });

  const recommended = suitableGauges[0]?.awg || '4/0';
  const alternative = suitableGauges[1]?.awg || null;

  return { recommended, alternative, allSuitable: suitableGauges };
}

/**
 * Parse AWG string to comparable number
 */
function parseAWG(awg: string): number {
  if (awg === '1/0') return -1;
  if (awg === '2/0') return -2;
  if (awg === '3/0') return -3;
  if (awg === '4/0') return -4;
  return parseInt(awg, 10);
}

/**
 * Recommend fuse size based on wire gauge and load current
 * Fuse should protect the wire, not the load
 */
export function recommendFuse(
  loadCurrent: number,
  wireGauge: string
): { recommended: number; nextSize: number; wireCapacity: number } {
  const wireSpec = WIRE_GAUGES.find(w => w.awg === wireGauge);
  const wireCapacity = wireSpec?.maxCurrent10Percent || loadCurrent * 1.5;

  // Fuse should be 125% of continuous load current
  const minFuseSize = loadCurrent * 1.25;
  
  // But not exceed wire capacity
  const maxFuseSize = wireCapacity;

  // Find smallest standard fuse that's >= minFuseSize and <= maxFuseSize
  let recommended = STANDARD_FUSE_RATINGS[0];
  let nextSize = STANDARD_FUSE_RATINGS[1];

  for (let i = 0; i < STANDARD_FUSE_RATINGS.length; i++) {
    if (STANDARD_FUSE_RATINGS[i] >= minFuseSize && STANDARD_FUSE_RATINGS[i] <= maxFuseSize) {
      recommended = STANDARD_FUSE_RATINGS[i];
      nextSize = STANDARD_FUSE_RATINGS[i + 1] || recommended;
      break;
    }
  }

  return { recommended, nextSize, wireCapacity };
}

/**
 * Recommend circuit breaker size
 */
export function recommendBreaker(loadCurrent: number): { recommended: number; nextSize: number } {
  const minSize = loadCurrent * 1.25;

  let recommended = STANDARD_BREAKER_RATINGS[0];
  let nextSize = STANDARD_BREAKER_RATINGS[1];

  for (let i = 0; i < STANDARD_BREAKER_RATINGS.length; i++) {
    if (STANDARD_BREAKER_RATINGS[i] >= minSize) {
      recommended = STANDARD_BREAKER_RATINGS[i];
      nextSize = STANDARD_BREAKER_RATINGS[i + 1] || recommended;
      break;
    }
  }

  return { recommended, nextSize };
}

/**
 * Calculate total system load
 */
export function calculateTotalLoad(loads: Array<{ current: number; dutyCycle?: number }>): {
  peakCurrent: number;
  averageCurrent: number;
  dailyAh: number;
} {
  let peakCurrent = 0;
  let weightedCurrent = 0;

  for (const load of loads) {
    const dutyCycle = load.dutyCycle || 1;
    peakCurrent += load.current;
    weightedCurrent += load.current * dutyCycle;
  }

  // Assume 8 hours of average use per day
  const dailyAh = weightedCurrent * 8;

  return { peakCurrent, averageCurrent: weightedCurrent, dailyAh };
}

/**
 * Calculate battery bank requirements
 */
export function calculateBatteryBank(
  dailyAh: number,
  daysAutonomy: number = 2,
  depthOfDischarge: number = 50,
  systemVoltage: number = 12
): {
  minimumCapacity: number;
  recommendedCapacity: number;
  watts: number;
} {
  // Account for days of autonomy and max discharge depth
  const minimumCapacity = (dailyAh * daysAutonomy) / (depthOfDischarge / 100);
  const recommendedCapacity = minimumCapacity * 1.2; // 20% safety margin
  const watts = recommendedCapacity * systemVoltage;

  return {
    minimumCapacity: Math.ceil(minimumCapacity),
    recommendedCapacity: Math.ceil(recommendedCapacity),
    watts: Math.ceil(watts),
  };
}

/**
 * Calculate solar panel requirements
 */
export function calculateSolarRequirements(
  dailyAh: number,
  peakSunHours: number = 5,
  systemEfficiency: number = 0.75
): {
  minimumWatts: number;
  recommendedWatts: number;
  panelCount100W: number;
} {
  // Watts = (Ah × Voltage) / (Sun Hours × Efficiency)
  const systemVoltage = 12;
  const minimumWatts = (dailyAh * systemVoltage) / (peakSunHours * systemEfficiency);
  const recommendedWatts = minimumWatts * 1.25;

  return {
    minimumWatts: Math.ceil(minimumWatts),
    recommendedWatts: Math.ceil(recommendedWatts),
    panelCount100W: Math.ceil(recommendedWatts / 100),
  };
}

/**
 * Validate circuit safety
 */
export function validateCircuit(
  loadCurrent: number,
  wireGauge: string,
  fuseRating: number,
  wireLengthFeet: number
): {
  isValid: boolean;
  warnings: string[];
  errors: string[];
} {
  const warnings: string[] = [];
  const errors: string[] = [];

  const wireSpec = WIRE_GAUGES.find(w => w.awg === wireGauge);
  if (!wireSpec) {
    errors.push(`Unknown wire gauge: ${wireGauge}`);
    return { isValid: false, warnings, errors };
  }

  // Check voltage drop
  const { percentDrop } = calculateVoltageDrop(loadCurrent, wireLengthFeet, wireGauge);
  if (percentDrop > 10) {
    errors.push(`Voltage drop (${percentDrop.toFixed(1)}%) exceeds 10% maximum`);
  } else if (percentDrop > 3) {
    warnings.push(`Voltage drop (${percentDrop.toFixed(1)}%) exceeds 3% recommended for critical circuits`);
  }

  // Check wire capacity
  if (loadCurrent > wireSpec.maxCurrent10Percent) {
    errors.push(`Wire gauge ${wireGauge} AWG cannot safely carry ${loadCurrent}A`);
  }

  // Check fuse sizing
  if (fuseRating < loadCurrent) {
    errors.push(`Fuse (${fuseRating}A) is undersized for load (${loadCurrent}A)`);
  }
  if (fuseRating > wireSpec.maxCurrent10Percent) {
    warnings.push(`Fuse (${fuseRating}A) may not protect ${wireGauge} AWG wire (max ${wireSpec.maxCurrent10Percent}A)`);
  }

  return {
    isValid: errors.length === 0,
    warnings,
    errors,
  };
}

/**
 * Get wire color code recommendation
 */
export function getWireColorRecommendation(purpose: string): string {
  const colorCodes: Record<string, string> = {
    'positive': 'Red - Positive DC',
    'negative': 'Black or Yellow - Negative DC',
    'ground': 'Green or Green/Yellow - Ground',
    'bilge': 'Orange - Bilge Pump',
    'nav-lights': 'Gray - Navigation Lights',
    'instruments': 'Violet - Instruments',
    'ignition': 'Purple - Ignition',
    'starting': 'Yellow/Red - Starting',
  };

  return colorCodes[purpose] || 'Check ABYC E-11 for color codes';
}
