import React, { useState } from 'react';
import { Node } from '@xyflow/react';
import { ComponentNodeData, ComponentSpec, WIRE_GAUGES } from '../../types';
import { recommendWireGauge, recommendFuse, calculateVoltageDrop } from '../../utils/calculations';

interface PropertiesPanelProps {
  selectedNode: Node<ComponentNodeData> | null;
  onUpdateNode: (id: string, data: Partial<ComponentNodeData>) => void;
  onDeleteNode: (id: string) => void;
}

export const PropertiesPanel: React.FC<PropertiesPanelProps> = ({
  selectedNode,
  onUpdateNode,
  onDeleteNode,
}) => {
  const [wireLength, setWireLength] = useState(10);
  const [wireCurrent, setWireCurrent] = useState(10);

  if (!selectedNode) {
    return (
      <aside className="w-72 bg-white border-l border-gray-200 p-4">
        <h2 className="text-lg font-bold text-gray-800 mb-4">🔧 Properties</h2>
        <p className="text-gray-500 text-sm">Select a component to edit its properties</p>
        
        <div className="mt-6 border-t pt-4">
          <h3 className="font-semibold text-gray-700 mb-3">📐 Wire Calculator</h3>
          
          <div className="space-y-3">
            <div>
              <label className="text-sm text-gray-600">Current (Amps)</label>
              <input
                type="number"
                value={wireCurrent}
                onChange={(e) => setWireCurrent(Number(e.target.value))}
                className="w-full mt-1 px-3 py-2 border rounded-md"
              />
            </div>
            <div>
              <label className="text-sm text-gray-600">Length (feet)</label>
              <input
                type="number"
                value={wireLength}
                onChange={(e) => setWireLength(Number(e.target.value))}
                className="w-full mt-1 px-3 py-2 border rounded-md"
              />
            </div>
            
            {wireCurrent > 0 && wireLength > 0 && (
              <WireRecommendation current={wireCurrent} length={wireLength} />
            )}
          </div>
        </div>
      </aside>
    );
  }

  const { data } = selectedNode;
  const spec = data.spec;

  const handleLabelChange = (label: string) => {
    onUpdateNode(selectedNode.id, { ...data, label });
  };

  const handleCustomValueChange = (key: string, value: number | string | boolean) => {
    onUpdateNode(selectedNode.id, {
      ...data,
      customValues: { ...data.customValues, [key]: value },
    });
  };

  const handleRotationChange = (rotation: number) => {
    onUpdateNode(selectedNode.id, { ...data, rotation });
  };

  const currentRotation = data.rotation || 0;

  return (
    <aside className="w-72 bg-white border-l border-gray-200 overflow-y-auto">
      <div className="p-4 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl">{spec?.icon || '⚡'}</span>
            <h2 className="text-lg font-bold text-gray-800">{spec?.name || 'Component'}</h2>
          </div>
          <button
            onClick={() => onDeleteNode(selectedNode.id)}
            className="text-red-500 hover:text-red-700 p-1"
            title="Delete component"
          >
            🗑️
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-1">{spec?.description}</p>
      </div>

      <div className="p-4 space-y-4">
        {/* Label */}
        <div>
          <label className="text-sm font-medium text-gray-700">Label</label>
          <input
            type="text"
            value={data.label}
            onChange={(e) => handleLabelChange(e.target.value)}
            className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        {/* Rotation Control */}
        <div>
          <label className="text-sm font-medium text-gray-700 mb-2 block">Rotation</label>
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              {[0, 90, 180, 270].map((deg) => (
                <button
                  key={deg}
                  onClick={() => handleRotationChange(deg)}
                  className={`w-10 h-10 rounded-lg border-2 flex items-center justify-center text-sm font-medium transition-all ${
                    currentRotation === deg
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 hover:border-gray-300 text-gray-600'
                  }`}
                  title={`Rotate ${deg}°`}
                >
                  {deg}°
                </button>
              ))}
            </div>
            <button
              onClick={() => handleRotationChange((currentRotation + 90) % 360)}
              className="w-10 h-10 rounded-lg border-2 border-gray-200 hover:border-blue-400 hover:bg-blue-50 flex items-center justify-center text-lg transition-all"
              title="Rotate 90° clockwise"
            >
              ↻
            </button>
          </div>
        </div>

        {/* Customizable values */}
        {spec?.customizable?.includes('capacity') && (
          <div>
            <label className="text-sm font-medium text-gray-700">Capacity (Ah)</label>
            <input
              type="number"
              value={data.customValues?.capacity || spec.capacity || 100}
              onChange={(e) => handleCustomValueChange('capacity', Number(e.target.value))}
              className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>
        )}

        {/* Battery Chemistry Selection */}
        {spec?.customizable?.includes('batteryChemistry') && (
          <div>
            <label className="text-sm font-medium text-gray-700">Battery Chemistry</label>
            <select
              value={(data.customValues?.batteryChemistry as string) || spec.batteryChemistry || 'lead-acid'}
              onChange={(e) => handleCustomValueChange('batteryChemistry', e.target.value)}
              className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-md"
            >
              <option value="lead-acid">Lead Acid (Flooded)</option>
              <option value="agm">AGM (Absorbed Glass Mat)</option>
              <option value="gel">Gel</option>
              <option value="lithium">Lithium Ion</option>
              <option value="lifepo4">LiFePO4 (Lithium Iron Phosphate)</option>
            </select>
            <p className="text-xs text-gray-500 mt-1">
              {(data.customValues?.batteryChemistry || spec.batteryChemistry) === 'lifepo4' || 
               (data.customValues?.batteryChemistry || spec.batteryChemistry) === 'lithium' 
                ? '⚡ Lithium: 80%+ usable, charges to 14.2V, no float'
                : '🔋 Lead-based: 50% usable, 3-stage charging (bulk/absorption/float)'}
            </p>
          </div>
        )}

        {spec?.customizable?.includes('rating') && (
          <div>
            <label className="text-sm font-medium text-gray-700">Rating (Amps)</label>
            <select
              value={data.customValues?.rating || spec.rating || 15}
              onChange={(e) => handleCustomValueChange('rating', Number(e.target.value))}
              className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-md"
            >
              {[1, 2, 3, 5, 7.5, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100, 150, 200].map(r => (
                <option key={r} value={r}>{r}A</option>
              ))}
            </select>
          </div>
        )}

        {spec?.customizable?.includes('maxCurrent') && (
          <div>
            <label className="text-sm font-medium text-gray-700">Max Current (Amps)</label>
            <input
              type="number"
              value={data.customValues?.maxCurrent || spec.maxCurrent || 10}
              onChange={(e) => handleCustomValueChange('maxCurrent', Number(e.target.value))}
              className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>
        )}

        {spec?.customizable?.includes('wattage') && (
          <div>
            <label className="text-sm font-medium text-gray-700">Wattage per Panel (W)</label>
            <input
              type="number"
              value={data.customValues?.wattage || spec.wattage || 100}
              onChange={(e) => handleCustomValueChange('wattage', Number(e.target.value))}
              className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>
        )}

        {/* Solar Array Configuration */}
        {spec?.customizable?.includes('panelCount') && (
          <div>
            <label className="text-sm font-medium text-gray-700">Number of Panels</label>
            <select
              value={data.customValues?.panelCount || spec.panelCount || 2}
              onChange={(e) => handleCustomValueChange('panelCount', Number(e.target.value))}
              className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-md"
            >
              {[2, 3, 4, 5, 6, 8, 10].map(n => (
                <option key={n} value={n}>{n} panels</option>
              ))}
            </select>
          </div>
        )}

        {spec?.customizable?.includes('arrayConfig') && (
          <div>
            <label className="text-sm font-medium text-gray-700">Array Configuration</label>
            <div className="mt-2 space-y-2">
              <button
                onClick={() => handleCustomValueChange('arrayConfig', 'parallel')}
                className={`w-full p-3 rounded-lg border-2 text-left transition-all ${
                  (data.customValues?.arrayConfig || spec.arrayConfig) === 'parallel'
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-xl">⫟</span>
                  <div>
                    <div className="font-semibold text-sm">Parallel</div>
                    <div className="text-xs text-gray-500">Same voltage, more current</div>
                  </div>
                </div>
                {(data.customValues?.arrayConfig || spec.arrayConfig) === 'parallel' && (
                  <div className="mt-2 text-xs text-blue-600 bg-blue-100 px-2 py-1 rounded">
                    {(() => {
                      const panelCount = (data.customValues?.panelCount as number) || spec.panelCount || 2;
                      const vmp = (data.customValues?.vmp as number) || spec.vmp || 18;
                      const imp = (data.customValues?.imp as number) || spec.imp || 5.56;
                      return `Output: ${vmp.toFixed(1)}V @ ${(imp * panelCount).toFixed(1)}A`;
                    })()}
                  </div>
                )}
              </button>
              <button
                onClick={() => handleCustomValueChange('arrayConfig', 'series')}
                className={`w-full p-3 rounded-lg border-2 text-left transition-all ${
                  (data.customValues?.arrayConfig || spec.arrayConfig) === 'series'
                    ? 'border-purple-500 bg-purple-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-xl">⫘</span>
                  <div>
                    <div className="font-semibold text-sm">Series</div>
                    <div className="text-xs text-gray-500">Higher voltage, same current</div>
                  </div>
                </div>
                {(data.customValues?.arrayConfig || spec.arrayConfig) === 'series' && (
                  <div className="mt-2 text-xs text-purple-600 bg-purple-100 px-2 py-1 rounded">
                    {(() => {
                      const panelCount = (data.customValues?.panelCount as number) || spec.panelCount || 2;
                      const vmp = (data.customValues?.vmp as number) || spec.vmp || 18;
                      const imp = (data.customValues?.imp as number) || spec.imp || 5.56;
                      return `Output: ${(vmp * panelCount).toFixed(1)}V @ ${imp.toFixed(1)}A`;
                    })()}
                  </div>
                )}
              </button>
            </div>
            {/* Configuration Tip */}
            <div className="mt-2 p-2 bg-gray-50 rounded text-xs text-gray-600">
              <strong>Tip:</strong> Use <span className="text-blue-600">Parallel</span> for 12V systems with PWM controllers. 
              Use <span className="text-purple-600">Series</span> for MPPT controllers that can handle higher voltage input.
            </div>
          </div>
        )}

        {/* Vmp and Imp for solar arrays */}
        {spec?.customizable?.includes('vmp') && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-sm font-medium text-gray-700">Vmp (V)</label>
              <input
                type="number"
                step="0.1"
                value={data.customValues?.vmp || spec.vmp || 18}
                onChange={(e) => handleCustomValueChange('vmp', Number(e.target.value))}
                className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Imp (A)</label>
              <input
                type="number"
                step="0.01"
                value={data.customValues?.imp || spec.imp || 5.56}
                onChange={(e) => handleCustomValueChange('imp', Number(e.target.value))}
                className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
          </div>
        )}

        {spec?.customizable?.includes('chargeRate') && (
          <div>
            <label className="text-sm font-medium text-gray-700">Charge Rate (Amps)</label>
            <input
              type="number"
              value={data.customValues?.chargeRate || spec.chargeRate || 30}
              onChange={(e) => handleCustomValueChange('chargeRate', Number(e.target.value))}
              className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>
        )}

        {/* On/Off toggle for loads */}
        {spec?.category === 'load' && (
          <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
            <div>
              <label className="text-sm font-medium text-gray-700">Power</label>
              <p className="text-xs text-gray-500">Turn load on or off</p>
            </div>
            <button
              onClick={() => handleCustomValueChange('isOn', !(data.customValues?.isOn !== false))}
              className={`relative w-14 h-7 rounded-full transition-colors ${
                data.customValues?.isOn !== false ? 'bg-green-500' : 'bg-gray-300'
              }`}
            >
              <div
                className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                  data.customValues?.isOn !== false ? 'translate-x-8' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        )}

        {/* Warnings and Errors */}
        {data.warnings.length > 0 && (
          <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-md">
            <h4 className="text-sm font-medium text-yellow-800 mb-1">⚠️ Warnings</h4>
            <ul className="text-xs text-yellow-700 list-disc list-inside">
              {data.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </div>
        )}

        {data.errors.length > 0 && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-md">
            <h4 className="text-sm font-medium text-red-800 mb-1">❌ Errors</h4>
            <ul className="text-xs text-red-700 list-disc list-inside">
              {data.errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </div>
        )}

        {/* Component-specific info */}
        <div className="border-t pt-4">
          <h4 className="text-sm font-medium text-gray-700 mb-2">Specifications</h4>
          <div className="text-xs text-gray-600 space-y-1">
            <div>Voltage: {spec?.voltage}V</div>
            {spec?.maxCurrent && <div>Max Current: {spec.maxCurrent}A</div>}
            {spec?.power && <div>Power: {spec.power}W</div>}
            {spec?.chargeRate && <div>Charge Rate: {spec.chargeRate}A</div>}
            {spec?.efficiency && <div>Efficiency: {spec.efficiency}%</div>}
          </div>
        </div>

        {/* DC-DC MPPT Charger detailed specs (Renogy DCC30S/DCC50S) */}
        {spec?.type === 'dc-dc-mppt-charger' && (
          <div className="border-t pt-4">
            <h4 className="text-sm font-medium text-purple-700 mb-2">🔄☀️ DC-DC MPPT Charger Specs</h4>
            <div className="text-xs space-y-2">
              {/* Alternator Input */}
              <div className="p-2 bg-red-50 rounded">
                <div className="font-medium text-red-700 mb-1">Alternator Input</div>
                <div className="text-gray-600">
                  <div>Voltage Range: {spec.alternatorInputMin}-{spec.alternatorInputMax}V</div>
                  <div>Max Output: {spec.chargeRate}A</div>
                </div>
              </div>
              
              {/* Solar MPPT Input */}
              <div className="p-2 bg-orange-50 rounded">
                <div className="font-medium text-orange-700 mb-1">Solar MPPT Input</div>
                <div className="text-gray-600">
                  <div>Voltage Range: {spec.solarInputMin}-{spec.solarInputMax}V (Voc)</div>
                  <div>Max Power: {spec.maxSolarWattage}W</div>
                  <div>Max Current: {spec.maxSolarCurrent}A</div>
                </div>
              </div>
              
              {/* Battery Types */}
              {spec.batteryTypes && (
                <div className="p-2 bg-green-50 rounded">
                  <div className="font-medium text-green-700 mb-1">Supported Batteries</div>
                  <div className="text-gray-600 flex flex-wrap gap-1">
                    {spec.batteryTypes.map((bt: string, i: number) => (
                      <span key={i} className="bg-green-100 px-1.5 py-0.5 rounded text-green-800">{bt}</span>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Physical specs */}
              <div className="p-2 bg-gray-50 rounded">
                <div className="font-medium text-gray-700 mb-1">Physical</div>
                <div className="text-gray-600">
                  {spec.dimensions && <div>Size: {spec.dimensions}</div>}
                  {spec.weight && <div>Weight: {spec.weight}kg</div>}
                  {spec.operatingTemp && <div>Temp: {spec.operatingTemp}</div>}
                  {spec.selfConsumption && <div>Standby: {spec.selfConsumption}mA</div>}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Recommendations */}
        {spec?.maxCurrent && (
          <div className="border-t pt-4">
            <h4 className="text-sm font-medium text-gray-700 mb-2">💡 Recommendations</h4>
            <ComponentRecommendations current={data.customValues?.maxCurrent as number || spec.maxCurrent} />
          </div>
        )}
      </div>
    </aside>
  );
};

const WireRecommendation: React.FC<{ current: number; length: number }> = ({ current, length }) => {
  const { recommended, alternative } = recommendWireGauge(current, length, 12, 3);
  const { recommended: fuseSizeRec } = recommendFuse(current, recommended);
  const { percentDrop } = calculateVoltageDrop(current, length, recommended);

  return (
    <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
      <h4 className="text-sm font-medium text-blue-800 mb-2">Recommendation</h4>
      <div className="text-xs text-blue-700 space-y-1">
        <div>🔌 Wire: <strong>{recommended} AWG</strong></div>
        {alternative && <div className="text-gray-500">Alt: {alternative} AWG</div>}
        <div>⚡ Fuse: <strong>{fuseSizeRec}A</strong></div>
        <div>📉 Voltage Drop: {percentDrop.toFixed(1)}%</div>
      </div>
    </div>
  );
};

const ComponentRecommendations: React.FC<{ current: number }> = ({ current }) => {
  const { recommended: fuseSize } = recommendFuse(current, '14');
  const { recommended: wireGauge } = recommendWireGauge(current, 10, 12, 3);

  return (
    <div className="text-xs text-gray-600 space-y-1">
      <div>📌 Suggested fuse: {fuseSize}A</div>
      <div>🔌 Min wire (10ft): {wireGauge} AWG</div>
    </div>
  );
};
