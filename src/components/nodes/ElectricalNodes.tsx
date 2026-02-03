import React, { memo } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { ComponentNodeData } from '../../types';

interface ElectricalNodeProps extends NodeProps {
  data: ComponentNodeData;
}

const categoryColors: Record<string, { bg: string; border: string; text: string }> = {
  'power-source': { bg: 'bg-green-100', border: 'border-green-500', text: 'text-green-800' },
  'distribution': { bg: 'bg-blue-100', border: 'border-blue-500', text: 'text-blue-800' },
  'protection': { bg: 'bg-yellow-100', border: 'border-yellow-500', text: 'text-yellow-800' },
  'charging': { bg: 'bg-purple-100', border: 'border-purple-500', text: 'text-purple-800' },
  'switching': { bg: 'bg-orange-100', border: 'border-orange-500', text: 'text-orange-800' },
  'load': { bg: 'bg-gray-100', border: 'border-gray-500', text: 'text-gray-800' },
  'ground': { bg: 'bg-emerald-100', border: 'border-emerald-500', text: 'text-emerald-800' },
};

// Helper to render rotation indicator badge
const RotationBadge = ({ rotation }: { rotation?: number }) => {
  if (!rotation) return null;
  return (
    <div className="absolute -top-2 -right-2 w-5 h-5 bg-blue-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center shadow-sm">
      {rotation}°
    </div>
  );
};

export const BatteryNode = memo(({ data, selected }: ElectricalNodeProps) => {
  const colors = categoryColors['power-source'];
  const capacity = data.customValues?.capacity || data.spec?.capacity || 100;

  return (
    <div className={`px-4 py-3 rounded-lg border-2 ${colors.bg} ${colors.border} ${selected ? 'ring-2 ring-blue-400' : ''} min-w-[140px] relative`}>
      <RotationBadge rotation={data.rotation} />
      {/* Negative terminal - BIDIRECTIONAL (both source and target for flexibility) */}
      <Handle type="target" position={Position.Left} className="w-3 h-3 !bg-blue-500" id="negative-in" style={{ top: '70%' }} />
      <Handle type="source" position={Position.Left} className="w-3 h-3 !bg-blue-500" id="negative-out" style={{ top: '70%' }} />
      
      {/* Positive terminal - BIDIRECTIONAL (both source and target for flexibility) */}
      <Handle type="target" position={Position.Right} className="w-3 h-3 !bg-red-500" id="positive-in" style={{ top: '30%' }} />
      <Handle type="source" position={Position.Right} className="w-3 h-3 !bg-red-500" id="positive-out" style={{ top: '30%' }} />
      
      {/* Terminal labels */}
      <div className="absolute left-1 text-[8px] font-bold text-blue-600" style={{ top: '65%' }}>NEG-</div>
      <div className="absolute right-1 text-[8px] font-bold text-red-600" style={{ top: '25%' }}>POS+</div>
      
      <div className="flex items-center gap-2 mb-1">
        <span className="text-2xl">🔋</span>
        <div className={`font-semibold ${colors.text}`}>{data.label}</div>
      </div>
      <div className="text-xs text-gray-600">
        <div>{capacity} Ah</div>
        <div>12V</div>
      </div>
      {data.warnings.length > 0 && (
        <div className="mt-1 text-xs text-yellow-600">⚠️ {data.warnings.length} warning(s)</div>
      )}
      {data.errors.length > 0 && (
        <div className="mt-1 text-xs text-red-600">❌ {data.errors.length} error(s)</div>
      )}
    </div>
  );
});

export const SolarPanelNode = memo(({ data, selected }: ElectricalNodeProps) => {
  const colors = categoryColors['power-source'];
  const wattage = data.customValues?.wattage || data.spec?.wattage || 100;

  return (
    <div className={`px-4 py-3 rounded-lg border-2 ${colors.bg} ${colors.border} ${selected ? 'ring-2 ring-blue-400' : ''} min-w-[140px] relative`}>
      <RotationBadge rotation={data.rotation} />
      <Handle type="target" position={Position.Left} className="w-3 h-3 !bg-blue-500" id="negative" />
      <Handle type="source" position={Position.Right} className="w-3 h-3 !bg-red-500" id="positive" />
      
      <div className="flex items-center gap-2 mb-1">
        <span className="text-2xl">☀️</span>
        <div className={`font-semibold ${colors.text}`}>{data.label}</div>
      </div>
      <div className="text-xs text-gray-600">
        <div>{wattage}W</div>
      </div>
    </div>
  );
});

export const SolarArrayNode = memo(({ data, selected }: ElectricalNodeProps) => {
  const colors = categoryColors['power-source'];
  const wattage = data.customValues?.wattage || data.spec?.wattage || 100;
  const panelCount = (data.customValues?.panelCount as number) || data.spec?.panelCount || 2;
  const arrayConfig = (data.customValues?.arrayConfig as string) || data.spec?.arrayConfig || 'parallel';
  const vmp = (data.customValues?.vmp as number) || data.spec?.vmp || 18;
  const imp = (data.customValues?.imp as number) || data.spec?.imp || 5.56;
  
  // Calculate array output based on configuration
  const totalWattage = wattage * panelCount;
  let arrayVoltage: number;
  let arrayCurrent: number;
  
  if (arrayConfig === 'series') {
    // Series: voltages add, current stays same
    arrayVoltage = vmp * panelCount;
    arrayCurrent = imp;
  } else {
    // Parallel: voltage stays same, currents add
    arrayVoltage = vmp;
    arrayCurrent = imp * panelCount;
  }

  return (
    <div className={`px-4 py-3 rounded-lg border-2 ${colors.bg} ${colors.border} ${selected ? 'ring-2 ring-blue-400' : ''} min-w-[160px] relative`}>
      <RotationBadge rotation={data.rotation} />
      <Handle type="target" position={Position.Left} className="w-3 h-3 !bg-blue-500" id="negative" />
      <Handle type="source" position={Position.Right} className="w-3 h-3 !bg-red-500" id="positive" />
      
      <div className="flex items-center gap-2 mb-1">
        <span className="text-2xl">☀️☀️</span>
        <div className={`font-semibold ${colors.text}`}>{data.label}</div>
      </div>
      <div className="text-xs text-gray-600">
        <div className="flex justify-between">
          <span>{panelCount}x {wattage}W</span>
          <span className="font-bold">{totalWattage}W</span>
        </div>
        <div className={`mt-1 px-1 py-0.5 rounded text-center text-[10px] font-bold ${
          arrayConfig === 'series' 
            ? 'bg-purple-200 text-purple-800' 
            : 'bg-blue-200 text-blue-800'
        }`}>
          {arrayConfig === 'series' ? '⫘ SERIES' : '⫟ PARALLEL'}
        </div>
        <div className="mt-1 text-[10px] text-gray-500">
          {arrayVoltage.toFixed(1)}V @ {arrayCurrent.toFixed(1)}A
        </div>
      </div>
    </div>
  );
});

export const AlternatorNode = memo(({ data, selected }: ElectricalNodeProps) => {
  const colors = categoryColors['power-source'];
  const maxCurrent = data.customValues?.maxCurrent || data.spec?.maxCurrent || 70;

  return (
    <div className={`px-4 py-3 rounded-lg border-2 ${colors.bg} ${colors.border} ${selected ? 'ring-2 ring-blue-400' : ''} min-w-[140px] relative`}>
      <RotationBadge rotation={data.rotation} />
      {/* Negative terminal - bidirectional */}
      <Handle type="target" position={Position.Left} className="w-3 h-3 !bg-blue-500" id="negative-in" style={{ top: '70%' }} />
      <Handle type="source" position={Position.Left} className="w-3 h-3 !bg-blue-500" id="negative-out" style={{ top: '70%' }} />
      
      {/* Positive terminal - bidirectional */}
      <Handle type="target" position={Position.Right} className="w-3 h-3 !bg-red-500" id="positive-in" style={{ top: '30%' }} />
      <Handle type="source" position={Position.Right} className="w-3 h-3 !bg-red-500" id="positive-out" style={{ top: '30%' }} />
      
      {/* Terminal labels */}
      <div className="absolute left-1 text-[8px] font-bold text-blue-600" style={{ top: '65%' }}>NEG-</div>
      <div className="absolute right-1 text-[8px] font-bold text-red-600" style={{ top: '25%' }}>POS+</div>
      
      <div className="flex items-center gap-2 mb-1">
        <span className="text-2xl">⚡</span>
        <div className={`font-semibold ${colors.text}`}>{data.label}</div>
      </div>
      <div className="text-xs text-gray-600">
        <div>{maxCurrent}A @ 14.4V</div>
        <div>Alternator</div>
      </div>
    </div>
  );
});

export const FuseNode = memo(({ data, selected }: ElectricalNodeProps) => {
  const colors = categoryColors['protection'];
  const rating = data.customValues?.rating || data.spec?.rating || 15;

  return (
    <div className={`px-3 py-2 rounded border-2 ${colors.bg} ${colors.border} ${selected ? 'ring-2 ring-blue-400' : ''} relative`}>
      <RotationBadge rotation={data.rotation} />
      {/* Bidirectional - fuses work both ways */}
      <Handle type="target" position={Position.Left} className="w-2 h-2 !bg-gray-500" id="in" />
      <Handle type="source" position={Position.Left} className="w-2 h-2 !bg-gray-500" id="in-out" />
      
      <Handle type="source" position={Position.Right} className="w-2 h-2 !bg-gray-500" id="out" />
      <Handle type="target" position={Position.Right} className="w-2 h-2 !bg-gray-500" id="out-in" />
      
      <div className="flex items-center gap-1">
        <span>⚡</span>
        <span className={`text-sm font-medium ${colors.text}`}>{rating}A</span>
      </div>
      <div className="text-xs text-gray-500">{data.label}</div>
    </div>
  );
});

export const SwitchNode = memo(({ data, selected }: ElectricalNodeProps) => {
  const colors = categoryColors['switching'];

  return (
    <div className={`px-4 py-3 rounded-lg border-2 ${colors.bg} ${colors.border} ${selected ? 'ring-2 ring-blue-400' : ''} min-w-[120px] relative`}>
      <RotationBadge rotation={data.rotation} />
      {/* Bidirectional - switches work both ways */}
      <Handle type="target" position={Position.Left} className="w-3 h-3 !bg-gray-500" id="in" />
      <Handle type="source" position={Position.Left} className="w-3 h-3 !bg-gray-500" id="in-out" />
      
      <Handle type="source" position={Position.Right} className="w-3 h-3 !bg-gray-500" id="out" />
      <Handle type="target" position={Position.Right} className="w-3 h-3 !bg-gray-500" id="out-in" />
      
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xl">🔘</span>
        <div className={`font-semibold ${colors.text}`}>{data.label}</div>
      </div>
    </div>
  );
});

export const LoadNode = memo(({ data, selected }: ElectricalNodeProps) => {
  const colors = categoryColors['load'];
  const current = data.customValues?.maxCurrent || data.spec?.maxCurrent || 5;
  const icon = data.spec?.icon || '⚡';
  const isOn = data.customValues?.isOn !== false; // Default to ON

  return (
    <div className={`px-4 py-3 rounded-lg border-2 ${isOn ? colors.bg : 'bg-gray-200'} ${isOn ? colors.border : 'border-gray-400'} ${selected ? 'ring-2 ring-blue-400' : ''} min-w-[130px] relative ${!isOn ? 'opacity-60' : ''}`}>
      <RotationBadge rotation={data.rotation} />
      <Handle type="target" position={Position.Left} className="w-3 h-3 !bg-red-500" id="positive" style={{ top: '30%' }} />
      <Handle type="target" position={Position.Left} className="w-3 h-3 !bg-blue-500" id="negative" style={{ top: '70%' }} />
      
      {/* On/Off indicator */}
      <div className={`absolute top-1 right-1 w-3 h-3 rounded-full ${isOn ? 'bg-green-500' : 'bg-red-500'}`} title={isOn ? 'ON' : 'OFF'}></div>
      
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xl">{icon}</span>
        <div className={`font-semibold ${isOn ? colors.text : 'text-gray-500'}`}>{data.label}</div>
      </div>
      <div className="text-xs text-gray-600">
        {isOn ? `${current}A @ 12V` : 'OFF'}
      </div>
    </div>
  );
});

export const BusBarNode = memo(({ data, selected }: ElectricalNodeProps) => {
  const colors = categoryColors['distribution'];

  return (
    <div className={`px-4 py-2 rounded border-2 ${colors.bg} ${colors.border} ${selected ? 'ring-2 ring-blue-400' : ''} min-w-[180px] relative`}>
      <RotationBadge rotation={data.rotation} />
      {/* Left side - bidirectional main input */}
      <Handle type="target" position={Position.Left} className="w-3 h-3 !bg-red-500" id="in" />
      <Handle type="source" position={Position.Left} className="w-3 h-3 !bg-red-500" id="in-out" />
      
      {/* Right side - bidirectional outputs */}
      <Handle type="source" position={Position.Right} className="w-2 h-2 !bg-red-500" id="out1" style={{ top: '20%' }} />
      <Handle type="target" position={Position.Right} className="w-2 h-2 !bg-red-500" id="out1-in" style={{ top: '20%' }} />
      
      <Handle type="source" position={Position.Right} className="w-2 h-2 !bg-red-500" id="out2" style={{ top: '40%' }} />
      <Handle type="target" position={Position.Right} className="w-2 h-2 !bg-red-500" id="out2-in" style={{ top: '40%' }} />
      
      <Handle type="source" position={Position.Right} className="w-2 h-2 !bg-red-500" id="out3" style={{ top: '60%' }} />
      <Handle type="target" position={Position.Right} className="w-2 h-2 !bg-red-500" id="out3-in" style={{ top: '60%' }} />
      
      <Handle type="source" position={Position.Right} className="w-2 h-2 !bg-red-500" id="out4" style={{ top: '80%' }} />
      <Handle type="target" position={Position.Right} className="w-2 h-2 !bg-red-500" id="out4-in" style={{ top: '80%' }} />
      
      <div className={`font-semibold ${colors.text} text-center`}>{data.label}</div>
      <div className="h-2 bg-red-600 rounded my-1"></div>
      <div className="text-xs text-gray-500 text-center">Positive Bus</div>
    </div>
  );
});

export const GroundBusNode = memo(({ data, selected }: ElectricalNodeProps) => {
  const colors = categoryColors['ground'];

  return (
    <div className={`px-4 py-2 rounded border-2 ${colors.bg} ${colors.border} ${selected ? 'ring-2 ring-blue-400' : ''} min-w-[180px] relative`}>
      <RotationBadge rotation={data.rotation} />
      {/* Left side connections - ALL bidirectional */}
      <Handle type="target" position={Position.Left} className="w-2 h-2 !bg-blue-500" id="in1" style={{ top: '20%' }} />
      <Handle type="source" position={Position.Left} className="w-2 h-2 !bg-blue-500" id="in1-out" style={{ top: '20%' }} />
      
      <Handle type="target" position={Position.Left} className="w-2 h-2 !bg-blue-500" id="in2" style={{ top: '40%' }} />
      <Handle type="source" position={Position.Left} className="w-2 h-2 !bg-blue-500" id="in2-out" style={{ top: '40%' }} />
      
      <Handle type="target" position={Position.Left} className="w-2 h-2 !bg-blue-500" id="in3" style={{ top: '60%' }} />
      <Handle type="source" position={Position.Left} className="w-2 h-2 !bg-blue-500" id="in3-out" style={{ top: '60%' }} />
      
      <Handle type="target" position={Position.Left} className="w-2 h-2 !bg-blue-500" id="in4" style={{ top: '80%' }} />
      <Handle type="source" position={Position.Left} className="w-2 h-2 !bg-blue-500" id="in4-out" style={{ top: '80%' }} />
      
      {/* Right side connections - ALL bidirectional */}
      <Handle type="source" position={Position.Right} className="w-2 h-2 !bg-blue-500" id="out1" style={{ top: '20%' }} />
      <Handle type="target" position={Position.Right} className="w-2 h-2 !bg-blue-500" id="out1-in" style={{ top: '20%' }} />
      
      <Handle type="source" position={Position.Right} className="w-2 h-2 !bg-blue-500" id="out2" style={{ top: '40%' }} />
      <Handle type="target" position={Position.Right} className="w-2 h-2 !bg-blue-500" id="out2-in" style={{ top: '40%' }} />
      
      <Handle type="source" position={Position.Right} className="w-2 h-2 !bg-blue-500" id="out3" style={{ top: '60%' }} />
      <Handle type="target" position={Position.Right} className="w-2 h-2 !bg-blue-500" id="out3-in" style={{ top: '60%' }} />
      
      <Handle type="source" position={Position.Right} className="w-2 h-2 !bg-blue-500" id="out4" style={{ top: '80%' }} />
      <Handle type="target" position={Position.Right} className="w-2 h-2 !bg-blue-500" id="out4-in" style={{ top: '80%' }} />
      
      <div className={`font-semibold ${colors.text} text-center`}>{data.label}</div>
      <div className="h-2 bg-blue-600 rounded my-1"></div>
      <div className="text-xs text-gray-500 text-center">Negative Bus (Ground)</div>
    </div>
  );
});

export const MPPTNode = memo(({ data, selected }: ElectricalNodeProps) => {
  const colors = categoryColors['charging'];
  const maxCurrent = data.customValues?.maxCurrent || data.spec?.maxCurrent || 30;

  return (
    <div className={`px-4 py-3 rounded-lg border-2 ${colors.bg} ${colors.border} ${selected ? 'ring-2 ring-blue-400' : ''} min-w-[150px] relative`}>
      <RotationBadge rotation={data.rotation} />
      <Handle type="target" position={Position.Left} className="w-3 h-3 !bg-orange-500" id="solar-pos" style={{ top: '25%' }} />
      <Handle type="target" position={Position.Left} className="w-3 h-3 !bg-gray-500" id="solar-neg" style={{ top: '75%' }} />
      <Handle type="source" position={Position.Right} className="w-3 h-3 !bg-red-500" id="battery-pos" style={{ top: '25%' }} />
      <Handle type="source" position={Position.Right} className="w-3 h-3 !bg-blue-500" id="battery-neg" style={{ top: '75%' }} />
      
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xl">📊</span>
        <div className={`font-semibold ${colors.text}`}>{data.label}</div>
      </div>
      <div className="text-xs text-gray-600">
        <div>MPPT Controller</div>
        <div>{maxCurrent}A max</div>
      </div>
    </div>
  );
});

export const DCDCChargerNode = memo(({ data, selected }: ElectricalNodeProps) => {
  const colors = categoryColors['charging'];
  const chargeRate = data.customValues?.chargeRate || data.spec?.chargeRate || 30;

  return (
    <div className={`px-4 py-3 rounded-lg border-2 ${colors.bg} ${colors.border} ${selected ? 'ring-2 ring-blue-400' : ''} min-w-[150px] relative`}>
      <RotationBadge rotation={data.rotation} />
      <Handle type="target" position={Position.Left} className="w-3 h-3 !bg-red-500" id="input-pos" style={{ top: '25%' }} />
      <Handle type="target" position={Position.Left} className="w-3 h-3 !bg-blue-500" id="input-neg" style={{ top: '75%' }} />
      <Handle type="source" position={Position.Right} className="w-3 h-3 !bg-red-500" id="output-pos" style={{ top: '25%' }} />
      <Handle type="source" position={Position.Right} className="w-3 h-3 !bg-blue-500" id="output-neg" style={{ top: '75%' }} />
      
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xl">🔄</span>
        <div className={`font-semibold ${colors.text}`}>{data.label}</div>
      </div>
      <div className="text-xs text-gray-600">
        <div>DC-DC Charger</div>
        <div>{chargeRate}A output</div>
      </div>
    </div>
  );
});

// Renogy DCC30S / DCC50S style DC-DC charger with built-in MPPT
// Connections match the real device - 4 main terminals as shown in wiring diagram
export const DCDCMPPTChargerNode = memo(({ data, selected }: ElectricalNodeProps) => {
  const colors = categoryColors['charging'];
  const spec = data.spec;
  const chargeRate = data.customValues?.chargeRate || spec?.chargeRate || 30;
  const maxSolarWattage = spec?.maxSolarWattage || 400;
  const maxSolarCurrent = spec?.maxSolarCurrent || 30;
  const solarInputMax = spec?.solarInputMax || 32;

  return (
    <div className={`rounded-lg border-2 ${colors.bg} ${colors.border} ${selected ? 'ring-2 ring-blue-400' : ''} shadow-lg relative`} style={{ width: '200px', height: '160px' }}>
      <RotationBadge rotation={data.rotation} />
      
      {/* === TOP - Solar Panel Input (PV+ and PV-) === */}
      <Handle 
        type="target" 
        position={Position.Top} 
        className="w-4 h-4 !bg-orange-500 !border-2 !border-white" 
        id="pv-pos" 
        style={{ left: '35%' }} 
        title="PV+ (Solar Panel Positive)" 
      />
      <Handle 
        type="target" 
        position={Position.Top} 
        className="w-4 h-4 !bg-gray-700 !border-2 !border-white" 
        id="pv-neg" 
        style={{ left: '65%' }} 
        title="PV- (Solar Panel Negative)" 
      />
      
      {/* === BOTTOM LEFT - Starter Battery Input (via ANL fuse) === */}
      <Handle 
        type="target" 
        position={Position.Bottom} 
        className="w-5 h-5 !bg-yellow-500 !border-2 !border-red-600" 
        id="starter-batt" 
        style={{ left: '25%' }} 
        title="Starter Battery (via ANL Fuse)" 
      />
      
      {/* === BOTTOM RIGHT - Auxiliary/House Battery Output (via ANL fuse) === */}
      <Handle 
        type="source" 
        position={Position.Bottom} 
        className="w-5 h-5 !bg-green-500 !border-2 !border-red-600" 
        id="aux-batt" 
        style={{ left: '75%' }} 
        title="Auxiliary Battery (via ANL Fuse)" 
      />
      
      {/* Header */}
      <div className="px-3 pt-6 pb-2">
        {/* Terminal Labels - Top */}
        <div className="absolute top-1 left-0 right-0 flex justify-around text-[9px] font-bold px-8">
          <span className="text-orange-600">PV+</span>
          <span className="text-gray-600">PV-</span>
        </div>
        
        {/* Main Content */}
        <div className="flex items-center justify-center gap-2 border-b border-purple-300 pb-2 mb-2">
          <div className="text-center">
            <div className="text-xs text-purple-600 font-bold">RENOGY</div>
            <div className={`font-bold ${colors.text} text-sm`}>{data.label}</div>
          </div>
        </div>
        
        {/* Specs */}
        <div className="text-[10px] space-y-1">
          <div className="flex justify-between">
            <span className="text-gray-500">DC-DC:</span>
            <span className="font-bold text-purple-700">{chargeRate}A</span>
            <span className="text-gray-500">MPPT:</span>
            <span className="font-bold text-orange-600">{maxSolarCurrent}A</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Solar:</span>
            <span className="font-mono">{maxSolarWattage}W / {solarInputMax}Voc</span>
          </div>
        </div>
        
        {/* Terminal Labels - Bottom */}
        <div className="absolute bottom-1 left-0 right-0 flex justify-between text-[8px] font-bold px-4">
          <span className="text-yellow-700">⚡STARTER</span>
          <span className="text-green-700">AUX⚡</span>
        </div>
      </div>

      {/* Warnings/Errors */}
      {data.warnings && data.warnings.length > 0 && (
        <div className="absolute top-1 right-1 text-[9px] text-yellow-600">⚠️</div>
      )}
      {data.errors && data.errors.length > 0 && (
        <div className="absolute top-1 right-1 text-[9px] text-red-600">❌</div>
      )}
    </div>
  );
});

export const GenericNode = memo(({ data, selected }: ElectricalNodeProps) => {
  const category = data.spec?.category || 'load';
  const colors = categoryColors[category] || categoryColors['load'];
  const icon = data.spec?.icon || '⚡';

  return (
    <div className={`px-4 py-3 rounded-lg border-2 ${colors.bg} ${colors.border} ${selected ? 'ring-2 ring-blue-400' : ''} min-w-[120px] relative`}>
      <RotationBadge rotation={data.rotation} />
      <Handle type="target" position={Position.Left} className="w-3 h-3 !bg-gray-500" id="in" />
      <Handle type="source" position={Position.Right} className="w-3 h-3 !bg-gray-500" id="out" />
      
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xl">{icon}</span>
        <div className={`font-semibold ${colors.text}`}>{data.label}</div>
      </div>
      {data.spec?.maxCurrent && (
        <div className="text-xs text-gray-600">{data.spec.maxCurrent}A</div>
      )}
    </div>
  );
});

// Node type mapping
export const nodeTypes = {
  'battery': BatteryNode,
  'battery-bank': BatteryNode,
  'solar-panel': SolarPanelNode,
  'solar-array': SolarArrayNode,
  'alternator': AlternatorNode,
  'fuse': FuseNode,
  'circuit-breaker': FuseNode,
  'anl-fuse': FuseNode,
  'battery-switch': SwitchNode,
  'toggle-switch': SwitchNode,
  'relay': SwitchNode,
  'solenoid': SwitchNode,
  'bus-bar': BusBarNode,
  'ground-bus': GroundBusNode,
  'bonding-bus': GroundBusNode,
  'mppt-controller': MPPTNode,
  'dc-dc-charger': DCDCChargerNode,
  'dc-dc-mppt-charger': DCDCMPPTChargerNode,
  'renogy-dcc30s': DCDCMPPTChargerNode,
  'renogy-dcc50s': DCDCMPPTChargerNode,
  'bilge-pump': LoadNode,
  'nav-lights': LoadNode,
  'anchor-light': LoadNode,
  'cabin-lights': LoadNode,
  'radio-vhf': LoadNode,
  'chartplotter': LoadNode,
  'depth-sounder': LoadNode,
  'windlass': LoadNode,
  'refrigerator': LoadNode,
  'water-pump': LoadNode,
  'horn': LoadNode,
  'usb-outlet': LoadNode,
  'outlet-12v': LoadNode,
  'starlink': LoadNode,
  'laptop': LoadNode,
  'monitor': LoadNode,
  'custom-load': LoadNode,
  'starter-motor': LoadNode,
  'trim-pump': LoadNode,
  'default': GenericNode,
};
